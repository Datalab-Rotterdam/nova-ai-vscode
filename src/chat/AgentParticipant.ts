import * as vscode from 'vscode';
import {NOVA_VENDOR} from '../core/constants';

const PARTICIPANT_ID = 'nova-ai.nova';
const MAX_TOOL_ROUNDS = 6;
const SYSTEM_PROMPT =
    'You are Nova, an AI assistant integrated in Visual Studio Code. ' +
    'Use available tools when they help answer the question accurately. ' +
    'Be concise and precise in your responses.';

export function registerAgentParticipant(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'favicon.svg');
    context.subscriptions.push(participant);
}

const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<void> => {
    const candidates = await vscode.lm.selectChatModels({vendor: NOVA_VENDOR});
    if (!candidates.length) {
        stream.markdown('Nova AI is not connected. Open the Nova AI panel to sign in.');
        return;
    }

    const model = candidates[0];
    const messages = buildMessages(request, context);
    const tools = [...vscode.lm.tools];

    await runAgentLoop(model, messages, tools, stream, request.toolInvocationToken, token);
};

async function runAgentLoop(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelToolInformation[],
    stream: vscode.ChatResponseStream,
    toolInvocationToken: vscode.ChatParticipantToolToken,
    token: vscode.CancellationToken
): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const options: vscode.LanguageModelChatRequestOptions = tools.length
            ? {tools}
            : {};

        const response = await model.sendRequest(messages, options, token);
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                stream.markdown(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push(part);
            }
        }

        if (!toolCalls.length) {
            break;
        }

        messages.push(vscode.LanguageModelChatMessage.Assistant(toolCalls));

        const toolResults: vscode.LanguageModelToolResultPart[] = [];
        for (const call of toolCalls) {
            stream.progress(`Running: ${call.name}`);
            try {
                const result = await vscode.lm.invokeTool(
                    call.name,
                    {toolInvocationToken, input: call.input as object},
                    token
                );
                toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Tool invocation failed.';
                toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [
                    new vscode.LanguageModelTextPart(msg)
                ]));
            }
        }

        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
    }
}

function buildMessages(
    request: vscode.ChatRequest,
    context: vscode.ChatContext
): vscode.LanguageModelChatMessage[] {
    const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)
    ];

    for (const turn of context.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        } else if (turn instanceof vscode.ChatResponseTurn) {
            const text = turn.response
                .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
                .map((p) => (typeof p.value === 'string' ? p.value : p.value.value))
                .join('');
            if (text) {
                messages.push(vscode.LanguageModelChatMessage.Assistant(text));
            }
        }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
    return messages;
}
