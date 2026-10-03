import * as vscode from 'vscode';
import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import { isThinkingPart } from '../core/apiSupport';
import { NOVA_THINKING_MIME_TYPE, NOVA_USAGE_MIME_TYPE } from '../core/constants';
import type { ToolNameMap } from './toolSchema';

/** `LanguageModelChatMessageRole.System` from the `languageModelSystem` proposal. */
const SYSTEM_ROLE = 3;

const EMPTY_TOOL_RESULT = '(no output)';
const MISSING_TOOL_RESULT = '(no result: the tool call was cancelled or its result is unavailable)';

export interface ToNovaMessagesOptions {
    /** Forward image data parts as `image_url` content; otherwise they are dropped. */
    supportsImages?: boolean;
    /** Maps VS Code tool names to the names that were sent to Nova. */
    toolNames?: ToolNameMap;
}

type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

interface ToolCallPayload {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

interface ClassifiedMessage {
    texts: string[];
    images: ContentPart[];
    toolCalls: ToolCallPayload[];
    toolResults: Array<{ callId: string; content: string }>;
}

/**
 * Translates VS Code chat messages into OpenAI-compatible Nova chat messages.
 *
 * Guarantees: no empty bodies, `tool` messages directly follow the assistant
 * message that declared their calls, every declared call has a result and
 * consecutive same-role messages are merged.
 */
export function toNovaMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ToNovaMessagesOptions = {}
): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const message of messages) {
        const parts = classifyParts(message.content, options);
        const role = message.role as number;

        if (role === SYSTEM_ROLE) {
            const text = joinText(parts.texts);
            if (text) {
                result.push({ role: 'system', content: text });
            }
            continue;
        }

        if (role === vscode.LanguageModelChatMessageRole.User) {
            // Tool results must directly follow the assistant tool_calls message,
            // so they go before any user text carried in the same message.
            for (const toolResult of parts.toolResults) {
                result.push({ role: 'tool', tool_call_id: toolResult.callId, content: toolResult.content });
            }

            const content = toUserContent(parts);
            if (content !== undefined) {
                result.push({ role: 'user', content });
            }
            continue;
        }

        const text = joinText(parts.texts);
        if (!text && !parts.toolCalls.length) {
            continue;
        }

        result.push({
            role: 'assistant',
            content: text || null,
            ...(parts.toolCalls.length ? { tool_calls: parts.toolCalls } : {})
        });
    }

    return mergeSameRole(pairToolMessages(result));
}

function classifyParts(content: readonly unknown[], options: ToNovaMessagesOptions): ClassifiedMessage {
    const classified: ClassifiedMessage = { texts: [], images: [], toolCalls: [], toolResults: [] };

    for (const part of content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            classified.texts.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
            classified.toolCalls.push({
                id: part.callId,
                type: 'function',
                function: {
                    name: options.toolNames?.toNova(part.name) ?? part.name,
                    arguments: JSON.stringify(part.input ?? {})
                }
            });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
            classified.toolResults.push({
                callId: part.callId,
                content: toolResultText(part.content) || EMPTY_TOOL_RESULT
            });
        } else if (part instanceof vscode.LanguageModelDataPart) {
            const decoded = decodeDataPart(part);
            if (decoded?.kind === 'text') {
                classified.texts.push(decoded.text);
            } else if (decoded?.kind === 'image' && options.supportsImages) {
                classified.images.push({ type: 'image_url', image_url: { url: decoded.url } });
            }
        } else {
            // Thinking parts and unknown future part types are not sent back to the model.
            const text = textOfUnknownPart(part);
            if (text) {
                classified.texts.push(text);
            }
        }
    }

    return classified;
}

type DecodedDataPart = { kind: 'text'; text: string } | { kind: 'image'; url: string };

/**
 * Only real content is forwarded. VS Code also sends metadata as data parts
 * (for example `cache_control` with `ephemeral`), and our own usage parts may
 * be echoed back. Those must never become message text.
 */
function decodeDataPart(part: vscode.LanguageModelDataPart): DecodedDataPart | undefined {
    const mimeType = part.mimeType.toLowerCase();

    if (mimeType.startsWith('image/')) {
        return { kind: 'image', url: `data:${mimeType};base64,${Buffer.from(part.data).toString('base64')}` };
    }

    if (mimeType === NOVA_USAGE_MIME_TYPE || mimeType === NOVA_THINKING_MIME_TYPE || !(mimeType.startsWith('text/') || mimeType === 'application/json')) {
        return undefined;
    }

    const text = new TextDecoder().decode(part.data);
    return text.trim() ? { kind: 'text', text } : undefined;
}

function textOfUnknownPart(part: unknown): string | undefined {
    if (!isRecord(part) || isThinkingPart(part)) {
        return undefined;
    }

    return typeof part.value === 'string' ? part.value : undefined;
}

export function toolResultText(content: readonly unknown[]): string {
    return content
        .map((item) => {
            if (item instanceof vscode.LanguageModelTextPart) {
                return item.value;
            }
            if (item instanceof vscode.LanguageModelDataPart) {
                const decoded = decodeDataPart(item);
                return decoded?.kind === 'text' ? decoded.text : decoded?.kind === 'image' ? '[image]' : '';
            }
            if (typeof item === 'string') {
                return item;
            }
            if (isRecord(item) && 'value' in item) {
                // LanguageModelPromptTsxPart carries a rendered prompt-tsx tree.
                return typeof item.value === 'string' ? item.value : promptTsxText(item.value);
            }
            return stringifyUnknown(item);
        })
        .filter((text) => text.trim().length > 0)
        .join('\n');
}

/** Extracts the text leaves of a serialized prompt-tsx tree. */
function promptTsxText(node: unknown): string {
    const texts: string[] = [];
    const visit = (value: unknown, depth: number): void => {
        if (depth > 64) {
            return;
        }
        if (typeof value === 'string') {
            texts.push(value);
        } else if (Array.isArray(value)) {
            value.forEach((child) => visit(child, depth + 1));
        } else if (isRecord(value)) {
            if (typeof value.text === 'string') {
                texts.push(value.text);
            }
            for (const key of ['node', 'children', 'value']) {
                if (key in value) {
                    visit(value[key], depth + 1);
                }
            }
        }
    };

    visit(node, 0);
    return texts.length ? texts.join('') : stringifyUnknown(node);
}

function toUserContent(parts: ClassifiedMessage): string | ContentPart[] | undefined {
    const text = joinText(parts.texts);
    if (!parts.images.length) {
        return text || undefined;
    }

    return [...(text ? [{ type: 'text', text } as const] : []), ...parts.images];
}

/**
 * Makes sure every assistant tool call has exactly one tool result directly after it,
 * and drops tool results that do not belong to the preceding assistant message.
 * VS Code may truncate or reorder history, which strict servers reject.
 */
function pairToolMessages(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];

        if (message.role === 'tool') {
            // Orphaned: not preceded by an assistant message that declared this call.
            continue;
        }

        result.push(message);

        const toolCalls = message.role === 'assistant' ? toolCallsOf(message) : [];
        if (!toolCalls.length) {
            continue;
        }

        const results = new Map<string, ChatMessage>();
        while (index + 1 < messages.length && messages[index + 1].role === 'tool') {
            const toolMessage = messages[++index];
            const callId = String(toolMessage.tool_call_id);
            if (toolCalls.some((call) => call.id === callId) && !results.has(callId)) {
                results.set(callId, toolMessage);
            }
        }

        for (const call of toolCalls) {
            result.push(results.get(call.id) ?? { role: 'tool', tool_call_id: call.id, content: MISSING_TOOL_RESULT });
        }
    }

    return result;
}

/** Strict chat templates (Mistral, Llama) reject consecutive messages with the same role. */
function mergeSameRole(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const message of messages) {
        const previous = result[result.length - 1];
        const mergeable = previous
            && previous.role === message.role
            && (message.role === 'system' || message.role === 'user'
                || (message.role === 'assistant' && !toolCallsOf(previous).length && !toolCallsOf(message).length));

        if (mergeable) {
            previous.content = mergeContent(previous.content, message.content);
        } else {
            result.push({ ...message });
        }
    }

    return result;
}

function mergeContent(left: unknown, right: unknown): unknown {
    if (typeof left === 'string' && typeof right === 'string') {
        return `${left}\n\n${right}`;
    }

    return [...asContentParts(left), ...asContentParts(right)];
}

function asContentParts(content: unknown): ContentPart[] {
    if (Array.isArray(content)) {
        return content as ContentPart[];
    }
    return typeof content === 'string' && content ? [{ type: 'text', text: content }] : [];
}

function toolCallsOf(message: ChatMessage): ToolCallPayload[] {
    return Array.isArray(message.tool_calls) ? message.tool_calls as ToolCallPayload[] : [];
}

function joinText(texts: readonly string[]): string {
    const joined = texts.filter((text) => text.length > 0).join('\n');
    return joined.trim() ? joined : '';
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return String(value);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
