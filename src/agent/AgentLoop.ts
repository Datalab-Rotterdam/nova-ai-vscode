import * as vscode from 'vscode';
import { isThinkingPart } from '../core/apiSupport';
import { NOVA_THINKING_MIME_TYPE, NOVA_USAGE_MIME_TYPE } from '../core/constants';
import { isContextOverflow } from '../core/errors';
import { COMPACTION_PROMPT } from '../core/prompts';
import { toolResultText } from '../model/messages';
import { estimateTextTokens } from '../model/tokenEstimator';
import { MAX_TOOLS } from '../model/toolSchema';
import { estimateMessagesTokens, fitToBudget, tokenCalibration, type CompactionStage } from './ContextManager';

export interface AgentLoopHost {
    text(value: string): void;
    thinking?(value: string, id: string): void;
    toolCall?(call: vscode.LanguageModelToolCallPart): void;
    toolResult?(call: vscode.LanguageModelToolCallPart, result: vscode.LanguageModelToolResult | undefined, error?: string): void;
    compacted?(stage: Exclude<CompactionStage, 'none'>): void;
    /** Prompt tokens reported for a request in this run. */
    usage?(promptTokens: number): void;
}

export interface AgentLoopRequest {
    model: vscode.LanguageModelChat;
    /** Full conversation so far, ending with the new user message. Updated in place. */
    messages: vscode.LanguageModelChatMessage[];
    /** Leading messages compaction must keep (system prompt, original goal). */
    pinned: number;
    tools: readonly vscode.LanguageModelToolInformation[];
    /** Tool the user referenced explicitly; it is required in the first round. */
    forcedTool?: string;
    invokeTool(call: vscode.LanguageModelToolCallPart, token: vscode.CancellationToken): Thenable<vscode.LanguageModelToolResult>;
    maxRounds: number;
    autoCompact: boolean;
    compactThreshold: number;
    /**
     * Messages the user sent while the loop runs ("steering"). Called before every model
     * request after the first, so the model sees them at its next step.
     */
    takeSteering?(): Promise<vscode.LanguageModelChatMessage[]>;
}

export interface ToolRound {
    response: string;
    calls: Array<{ callId: string; name: string; input: object; result: string }>;
}

export interface AgentLoopResult {
    rounds: ToolRound[];
    /** Text of the final response, after the last tool round. */
    finalText: string;
    /** Latest summary written when the conversation was compacted during this run. */
    summary?: string;
    promptTokens: number;
    completionTokens: number;
    /** Prompt tokens of the last request: how full the context window is now. */
    lastPromptTokens: number;
    outputBuffer?: number;
    hitRoundLimit: boolean;
}

/** Max characters of a tool result kept for replaying history in later turns. */
const HISTORY_RESULT_CHARS = 4_000;

/**
 * Runs the model ↔ tool loop shared by the `@nova` participant and the Nova chat panel:
 * stream a response, invoke the requested tools, feed the results back, repeat.
 * Keeps the conversation inside the context window and recovers once from overflow errors.
 */
export async function runAgentLoop(
    request: AgentLoopRequest,
    host: AgentLoopHost,
    token: vscode.CancellationToken
): Promise<AgentLoopResult> {
    const { model, messages } = request;
    const tools = request.tools.slice(0, MAX_TOOLS);
    const toolTokens = tools.length
        ? estimateTextTokens(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))))
        : 0;
    const result: AgentLoopResult = { rounds: [], finalText: '', promptTokens: 0, completionTokens: 0, lastPromptTokens: 0, hitRoundLimit: false };

    for (let round = 0; round < request.maxRounds; round++) {
        if (token.isCancellationRequested) {
            break;
        }

        const forced = round === 0 && request.forcedTool ? tools.filter((tool) => tool.name === request.forcedTool) : [];
        const options: vscode.LanguageModelChatRequestOptions = forced.length
            ? { tools: forced, toolMode: vscode.LanguageModelChatToolMode.Required }
            : tools.length ? { tools, toolMode: vscode.LanguageModelChatToolMode.Auto } : {};

        if (round > 0 && request.takeSteering) {
            messages.push(...await request.takeSteering());
        }

        if (request.autoCompact) {
            result.summary = await compact(request, host, toolTokens, request.compactThreshold, token) ?? result.summary;
        }

        const estimatedTokens = estimateMessagesTokens(messages) + toolTokens;
        let response: vscode.LanguageModelChatResponse;
        try {
            response = await model.sendRequest(messages, options, token);
        } catch (error) {
            if (!isContextOverflow(error)) {
                throw error;
            }
            // The estimate was off: compact hard and retry once.
            result.summary = await compact(request, host, toolTokens, 0, token, 0.5) ?? result.summary;
            response = await model.sendRequest(messages, options, token);
        }

        const text: string[] = [];
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        for await (const part of response.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                text.push(part.value);
                host.text(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push(part);
            } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === NOVA_USAGE_MIME_TYPE) {
                const usage = JSON.parse(new TextDecoder().decode(part.data)) as { promptTokens?: number; completionTokens?: number; outputBuffer?: number };
                result.promptTokens += usage.promptTokens ?? 0;
                result.completionTokens += usage.completionTokens ?? 0;
                result.outputBuffer ??= usage.outputBuffer;
                if (usage.promptTokens) {
                    result.lastPromptTokens = usage.promptTokens;
                    tokenCalibration.record(model.id, estimatedTokens, usage.promptTokens);
                    host.usage?.(usage.promptTokens);
                }
            } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === NOVA_THINKING_MIME_TYPE) {
                host.thinking?.(new TextDecoder().decode(part.data), `nova-thinking-${round}`);
            } else if (isThinkingPart(part)) {
                const value = Array.isArray(part.value) ? part.value.join('') : part.value;
                host.thinking?.(value, `nova-thinking-${round}`);
            }
        }

        const responseText = text.join('');
        const assistantContent: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [
            ...(responseText ? [new vscode.LanguageModelTextPart(responseText)] : []),
            ...toolCalls
        ];
        if (assistantContent.length) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));
        }

        if (!toolCalls.length) {
            result.finalText = responseText;
            break;
        }

        const toolRound: ToolRound = { response: responseText, calls: [] };
        const toolResults: vscode.LanguageModelToolResultPart[] = [];
        for (const call of toolCalls) {
            host.toolCall?.(call);
            let content: unknown[];
            try {
                const toolResult = await request.invokeTool(call, token);
                content = toolResult.content;
                host.toolResult?.(call, toolResult);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Tool invocation failed.';
                content = [new vscode.LanguageModelTextPart(`Error: ${message}`)];
                host.toolResult?.(call, undefined, message);
            }

            toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, content));
            toolRound.calls.push({
                callId: call.callId,
                name: call.name,
                input: call.input,
                result: truncate(toolResultText(content), HISTORY_RESULT_CHARS)
            });

            if (token.isCancellationRequested) {
                break;
            }
        }

        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
        result.rounds.push(toolRound);

        if (round === request.maxRounds - 1) {
            result.hitRoundLimit = true;
        }
    }

    return result;
}

async function compact(
    request: AgentLoopRequest,
    host: AgentLoopHost,
    toolTokens: number,
    threshold: number,
    token: vscode.CancellationToken,
    budgetShare = 1
): Promise<string | undefined> {
    const { model, messages } = request;
    const budget = Math.max(1_024, Math.floor((model.maxInputTokens - toolTokens) * budgetShare));
    let summary: string | undefined;
    const fitted = await fitToBudget(
        messages,
        (role, content) => new vscode.LanguageModelChatMessage(role, content as vscode.LanguageModelChatMessage['content']),
        {
            budget,
            threshold,
            pinned: request.pinned,
            summarize: async (transcript) => (summary = await summarize(model, transcript, budget, token))
        },
        tokenCalibration.ratio(model.id)
    );

    if (fitted.stage === 'none') {
        return undefined;
    }

    messages.splice(0, messages.length, ...fitted.messages);
    host.compacted?.(fitted.stage);
    return fitted.stage === 'summarized' ? summary : undefined;
}

/** Asks the model for a summary of older turns, without tools; `focus` says what the summary should keep. */
export async function summarize(
    model: vscode.LanguageModelChat,
    transcript: string,
    budget: number,
    token: vscode.CancellationToken,
    focus?: string
): Promise<string> {
    // Leave room for the prompt itself and the summary.
    const maxTranscriptChars = Math.max(2_000, Math.floor(budget * 0.6) * 3);
    const clipped = transcript.length > maxTranscriptChars
        ? `[… earlier transcript omitted …]\n${transcript.slice(transcript.length - maxTranscriptChars)}`
        : transcript;

    const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(COMPACTION_PROMPT.replace('{transcript}', () => clipped) + (focus ? `\n\nFocus the summary on: ${focus}` : ''))],
        {},
        token
    );

    let summary = '';
    for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            summary += part.value;
        }
    }
    return summary;
}

function truncate(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[… truncated …]`;
}
