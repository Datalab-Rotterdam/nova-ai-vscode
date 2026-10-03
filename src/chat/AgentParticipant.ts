import * as vscode from 'vscode';
import { runAgentLoop, summarize, type ToolRound } from '../agent/AgentLoop';
import { buildTranscript } from '../agent/ContextManager';
import { getEnabledRequestTools, getSystemRole, reportThinking, reportUsage } from '../core/apiSupport';
import { getCompactThreshold, getMaxToolRounds, isAutoCompactEnabled } from '../core/config';
import { COMMAND_MANAGE, NOVA_VENDOR } from '../core/constants';
import { NOVA_PARTICIPANT_PROMPT } from '../core/prompts';
import type { MemoryService } from '../memory/MemoryService';
import { MAX_TOOLS } from '../model/toolSchema';

export const PARTICIPANT_ID = 'nova-ai.nova';

/** Max characters of an attached file sent to the model. */
const MAX_REFERENCE_CHARS = 60_000;

const COMMAND_INSTRUCTIONS: Record<string, string> = {
    explain: 'Explain how the referenced code works: start with a short summary, then walk through the control flow and point out non-obvious behaviour.',
    fix: 'Find and fix the problem described below. Inspect the relevant code with the tools, apply a minimal fix and explain what was wrong.',
    tests: 'Write tests for the referenced code using the project\'s existing test framework and conventions, then run them if possible.'
};

/** Stored in `ChatResult.metadata` so later turns can replay tool calls, which VS Code history does not expose. */
interface NovaChatMetadata {
    rounds?: ToolRound[];
    finalText?: string;
    /** Summary of everything before this turn's response (`/compact`, or auto-compaction during the turn). */
    summary?: string;
}

let memory: MemoryService | undefined;

export function registerAgentParticipant(context: vscode.ExtensionContext, memoryService?: MemoryService): void {
    memory = memoryService;
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    // Contributed icon font glyph: follows the theme's foreground color.
    participant.iconPath = new vscode.ThemeIcon('nova-logo');
    context.subscriptions.push(participant);
}

const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    const model = await resolveModel(request);
    if (!model) {
        stream.markdown('Nova AI is not connected. Sign in to use Nova models.');
        stream.button({ command: COMMAND_MANAGE, title: 'Connect Nova AI' });
        return {};
    }

    const memorySection = memory?.isEnabled() ? await memory.promptSection().catch(() => '') : '';
    const messages = [createSystemMessage(memorySection), ...buildHistory(context.history)];
    const pinned = 1;

    try {
        if (request.command === 'compact') {
            return await compactConversation(model, messages, stream, token);
        }

        messages.push(await buildUserMessage(request));

        const { tools, forcedTool } = selectTools(request);
        const result = await runAgentLoop({
            model,
            messages,
            pinned,
            tools,
            forcedTool,
            invokeTool: (call, callToken) => vscode.lm.invokeTool(
                call.name,
                { toolInvocationToken: request.toolInvocationToken, input: call.input },
                callToken
            ),
            maxRounds: getMaxToolRounds(),
            autoCompact: isAutoCompactEnabled(),
            compactThreshold: getCompactThreshold()
        }, {
            text: (value) => stream.markdown(value),
            thinking: (value, id) => reportThinking(stream, value, id),
            compacted: () => stream.progress('Compacted earlier conversation to fit the context window.')
        }, token);

        if (result.hitRoundLimit) {
            stream.markdown(`\n\n_Stopped after ${getMaxToolRounds()} tool rounds. Reply "continue" to keep going, or raise \`nova.agent.maxToolRounds\`._`);
        }

        if (result.promptTokens > 0 || result.completionTokens > 0) {
            reportUsage(stream, {
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                outputBuffer: result.outputBuffer
            });
        }

        const metadata: NovaChatMetadata = { rounds: result.rounds, finalText: result.finalText, summary: result.summary };
        return { metadata };
    } catch (error) {
        if (token.isCancellationRequested) {
            return {};
        }
        if (error instanceof vscode.LanguageModelError && error.code === vscode.LanguageModelError.NoPermissions().code) {
            stream.button({ command: COMMAND_MANAGE, title: 'Connect Nova AI' });
        }
        return { errorDetails: { message: error instanceof Error ? error.message : 'Nova AI request failed.' } };
    }
};

/** Uses the model picked in the chat input when it is a Nova model. */
async function resolveModel(request: vscode.ChatRequest): Promise<vscode.LanguageModelChat | undefined> {
    if (request.model?.vendor === NOVA_VENDOR) {
        return request.model;
    }
    const [model] = await vscode.lm.selectChatModels({ vendor: NOVA_VENDOR });
    return model;
}

function createSystemMessage(memorySection = ''): vscode.LanguageModelChatMessage {
    const prompt = memorySection ? `${NOVA_PARTICIPANT_PROMPT}\n\n${memorySection}` : NOVA_PARTICIPANT_PROMPT;
    const systemRole = getSystemRole();
    return systemRole !== undefined
        ? new vscode.LanguageModelChatMessage(systemRole, prompt)
        : vscode.LanguageModelChatMessage.User(prompt);
}

/**
 * Rebuilds the conversation, including tool calls and results from earlier turns
 * (stored in result metadata). A `/compact` summary replaces everything before it.
 */
export function buildHistory(history: vscode.ChatContext['history']): vscode.LanguageModelChatMessage[] {
    let messages: vscode.LanguageModelChatMessage[] = [];

    for (const turn of history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            if (turn.command !== 'compact') {
                messages.push(vscode.LanguageModelChatMessage.User(withCommand(turn.command, turn.prompt)));
            }
            continue;
        }

        if (!(turn instanceof vscode.ChatResponseTurn)) {
            continue;
        }

        const metadata = turn.result.metadata as NovaChatMetadata | undefined;
        if (metadata?.summary) {
            // Continue from the summary instead of re-sending (and re-compacting) older turns.
            // An auto-compacted turn keeps its own prompt; `/compact` turns have none.
            const prompt = metadata.rounds ? messages[messages.length - 1] : undefined;
            messages = [vscode.LanguageModelChatMessage.User(summaryBlock(metadata.summary)), ...(prompt ? [prompt] : [])];
            if (!metadata.rounds) {
                continue;
            }
        }

        for (const round of metadata?.rounds ?? []) {
            messages.push(vscode.LanguageModelChatMessage.Assistant([
                ...(round.response ? [new vscode.LanguageModelTextPart(round.response)] : []),
                ...round.calls.map((call) => new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input))
            ]));
            messages.push(vscode.LanguageModelChatMessage.User(round.calls.map((call) =>
                new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(call.result)]))));
        }

        const text = metadata?.finalText ?? markdownOf(turn);
        if (text) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
    }

    return messages;
}

function markdownOf(turn: vscode.ChatResponseTurn): string {
    return turn.response
        .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
        .map((part) => part.value.value)
        .join('');
}

async function buildUserMessage(request: vscode.ChatRequest): Promise<vscode.LanguageModelChatMessage> {
    const content: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];
    const attachments: string[] = [];

    for (const reference of request.references) {
        const resolved = await resolveReference(reference);
        if (resolved instanceof vscode.LanguageModelDataPart) {
            content.push(resolved);
        } else if (resolved) {
            attachments.push(resolved);
        }
    }

    if (attachments.length) {
        content.push(new vscode.LanguageModelTextPart(`<attachments>\n${attachments.join('\n\n')}\n</attachments>`));
    }
    content.push(new vscode.LanguageModelTextPart(withCommand(request.command, request.prompt)));

    return vscode.LanguageModelChatMessage.User(content);
}

async function resolveReference(reference: vscode.ChatPromptReference): Promise<string | vscode.LanguageModelDataPart | undefined> {
    const value = reference.value;
    const description = reference.modelDescription ? ` description="${reference.modelDescription}"` : '';

    try {
        if (value instanceof vscode.Uri) {
            const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(value));
            return attachment(vscode.workspace.asRelativePath(value), text, description);
        }

        if (value instanceof vscode.Location) {
            const document = await vscode.workspace.openTextDocument(value.uri);
            const path = `${vscode.workspace.asRelativePath(value.uri)}:${value.range.start.line + 1}-${value.range.end.line + 1}`;
            return attachment(path, document.getText(value.range), description);
        }

        if (typeof value === 'string') {
            return attachment(reference.id, value, description);
        }

        // ChatReferenceBinaryData (images pasted into chat).
        if (isBinaryData(value) && value.mimeType.startsWith('image/')) {
            return new vscode.LanguageModelDataPart(await value.data(), value.mimeType);
        }
    } catch {
        return `<attachment id="${reference.id}" error="could not be read" />`;
    }

    return undefined;
}

function attachment(id: string, text: string, description: string): string {
    const clipped = text.length > MAX_REFERENCE_CHARS ? `${text.slice(0, MAX_REFERENCE_CHARS)}\n[… truncated …]` : text;
    return `<attachment id="${id}"${description}>\n${clipped}\n</attachment>`;
}

function isBinaryData(value: unknown): value is { mimeType: string; data(): Thenable<Uint8Array> } {
    return typeof value === 'object' && value !== null
        && typeof (value as { mimeType?: unknown }).mimeType === 'string'
        && typeof (value as { data?: unknown }).data === 'function';
}

/** Tools enabled in the chat tool picker, or all registered tools; explicitly referenced tools first. */
function selectTools(request: vscode.ChatRequest): { tools: vscode.LanguageModelToolInformation[]; forcedTool?: string } {
    const available = getEnabledRequestTools(request) ?? [...vscode.lm.tools];
    const referenced = new Set(request.toolReferences.map((reference) => reference.name));
    const tools = [
        ...available.filter((tool) => referenced.has(tool.name)),
        ...available.filter((tool) => !referenced.has(tool.name))
    ].slice(0, MAX_TOOLS);

    return { tools, forcedTool: request.toolReferences[0]?.name };
}

async function compactConversation(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const history = messages.slice(1);
    if (!history.length) {
        stream.markdown('Nothing to compact yet.');
        return {};
    }

    stream.progress('Summarizing the conversation…');
    const summary = await summarize(model, buildTranscript(history), model.maxInputTokens, token);
    stream.markdown(`Conversation compacted. Later messages continue from this summary:\n\n${summary}`);
    const metadata: NovaChatMetadata = { summary };
    return { metadata };
}

function summaryBlock(summary: string): string {
    return `<conversation-summary>\nEarlier parts of this conversation were compacted. Summary:\n\n${summary}\n</conversation-summary>`;
}

function withCommand(command: string | undefined, prompt: string): string {
    const instruction = command ? COMMAND_INSTRUCTIONS[command] : undefined;
    return instruction ? `${instruction}\n\n${prompt}` : prompt;
}
