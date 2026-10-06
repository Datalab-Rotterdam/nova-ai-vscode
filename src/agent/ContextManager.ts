import * as vscode from 'vscode';
import { toolResultText } from '../model/messages';
import { estimateTextTokens, estimateTokenCount } from '../model/tokenEstimator';

/** Message shape shared by `LanguageModelChatMessage` and `LanguageModelChatRequestMessage`. */
export interface ChatMessageLike {
    readonly role: vscode.LanguageModelChatMessageRole;
    readonly content: readonly unknown[];
    readonly name?: string;
}

export type CompactionStage = 'none' | 'pruned' | 'summarized' | 'trimmed';

export interface FitOptions {
    /** Input tokens available for messages (context window minus output, tools and margin). */
    budget: number;
    /** Compact once the estimate exceeds this share of the budget. */
    threshold: number;
    /** Leading messages that are never removed (system prompt, original goal). */
    pinned: number;
    /** Writes a summary of the given transcript; omitted in contexts where an extra model call is too slow. */
    summarize?: (transcript: string) => Promise<string>;
}

export interface FitResult<T extends ChatMessageLike> {
    messages: T[];
    stage: CompactionStage;
    estimatedTokens: number;
}

const PRUNED_RESULT_TOKENS = 400;
const KEEP_RECENT_TOOL_RESULTS = 4;
const TRANSCRIPT_RESULT_CHARS = 1_500;

/**
 * Per-model correction between our byte-based estimate and the prompt tokens the
 * server reports, so the compaction trigger stays accurate across tokenizers.
 */
export class TokenCalibration {
    private readonly ratios = new Map<string, number>();

    public ratio(modelId: string): number {
        return this.ratios.get(modelId) ?? 1;
    }

    public record(modelId: string, estimatedTokens: number, actualTokens: number): void {
        if (estimatedTokens <= 0 || actualTokens <= 0) {
            return;
        }

        const observed = clamp(actualTokens / estimatedTokens, 0.5, 2);
        const previous = this.ratios.get(modelId);
        this.ratios.set(modelId, previous === undefined ? observed : previous * 0.6 + observed * 0.4);
    }
}

export const tokenCalibration = new TokenCalibration();

export function estimateMessagesTokens(messages: readonly ChatMessageLike[], ratio = 1): number {
    return Math.ceil(messages.reduce((total, message) => total + estimateTokenCount(message), 0) * ratio);
}

/**
 * Keeps a conversation inside the model's input budget. Stages, cheapest first:
 * 1. prune old tool results to their head and tail,
 * 2. summarize older turns with one model call (when `summarize` is given),
 * 3. drop the oldest turns.
 * Tool calls and their results are never separated.
 */
export async function fitToBudget<T extends ChatMessageLike>(
    messages: readonly T[],
    create: (role: vscode.LanguageModelChatMessageRole, content: unknown[]) => T,
    options: FitOptions,
    ratio = 1
): Promise<FitResult<T>> {
    const estimate = (list: readonly ChatMessageLike[]) => estimateMessagesTokens(list, ratio);
    const trigger = options.budget * options.threshold;
    // Compact well below the trigger so the next rounds have room.
    const target = options.budget * Math.min(options.threshold, 0.6);

    let current = [...messages];
    let tokens = estimate(current);
    if (tokens <= trigger) {
        return { messages: current, stage: 'none', estimatedTokens: tokens };
    }

    current = pruneToolResults(current, create);
    tokens = estimate(current);
    if (tokens <= target) {
        return { messages: current, stage: 'pruned', estimatedTokens: tokens };
    }

    if (options.summarize) {
        const summarized = await summarizeOlderTurns(current, create, options, target, estimate);
        if (summarized) {
            tokens = estimate(summarized);
            if (tokens <= options.budget) {
                return { messages: summarized, stage: 'summarized', estimatedTokens: tokens };
            }
            current = summarized;
        }
    }

    current = trimOldest(current, options.pinned, options.budget, estimate);
    return { messages: current, stage: 'trimmed', estimatedTokens: estimate(current) };
}

/** Shortens tool results outside the most recent ones to a head and tail excerpt. */
export function pruneToolResults<T extends ChatMessageLike>(
    messages: readonly T[],
    create: (role: vscode.LanguageModelChatMessageRole, content: unknown[]) => T
): T[] {
    const resultIndexes = messages
        .map((message, index) => (message.content.some(isToolResult) ? index : -1))
        .filter((index) => index >= 0);
    const recent = new Set(resultIndexes.slice(-KEEP_RECENT_TOOL_RESULTS));

    return messages.map((message, index) => {
        if (recent.has(index) || !message.content.some(isToolResult)) {
            return message;
        }

        let changed = false;
        const content = message.content.map((part) => {
            if (!isToolResult(part)) {
                return part;
            }
            const text = toolResultText(part.content);
            if (estimateTextTokens(text) <= PRUNED_RESULT_TOKENS) {
                return part;
            }
            changed = true;
            return new vscode.LanguageModelToolResultPart(part.callId, [
                new vscode.LanguageModelTextPart(excerpt(text, PRUNED_RESULT_TOKENS * 3))
            ]);
        });

        return changed ? create(message.role, content) : message;
    });
}

async function summarizeOlderTurns<T extends ChatMessageLike>(
    messages: readonly T[],
    create: (role: vscode.LanguageModelChatMessageRole, content: unknown[]) => T,
    options: FitOptions,
    target: number,
    estimate: (list: readonly ChatMessageLike[]) => number
): Promise<T[] | undefined> {
    const pinned = messages.slice(0, options.pinned);
    const boundaries = safeBoundaries(messages, options.pinned);

    // Keep as many recent messages as fit in half of the target, starting at a safe boundary.
    const recentBudget = target / 2;
    let cut = boundaries.find((index) => estimate(messages.slice(index)) <= recentBudget)
        ?? boundaries[boundaries.length - 1];
    if (cut === undefined || cut <= options.pinned) {
        return undefined;
    }

    const older = messages.slice(options.pinned, cut);
    if (!older.length) {
        return undefined;
    }

    const summary = (await options.summarize!(buildTranscript(older))).trim();
    if (!summary) {
        return undefined;
    }

    return [
        ...pinned,
        create(vscode.LanguageModelChatMessageRole.User, [
            new vscode.LanguageModelTextPart(summaryBlock(summary))
        ]),
        ...messages.slice(cut)
    ];
}

/** Drops the oldest messages after the pinned ones, at safe boundaries, until the conversation fits. */
function trimOldest<T extends ChatMessageLike>(
    messages: readonly T[],
    pinned: number,
    budget: number,
    estimate: (list: readonly ChatMessageLike[]) => number
): T[] {
    const head = messages.slice(0, pinned);
    for (const boundary of safeBoundaries(messages, pinned)) {
        const candidate = [...head, ...messages.slice(boundary)];
        if (estimate(candidate) <= budget) {
            return candidate;
        }
    }

    // Even the last turn alone does not fit: keep it and let the server decide.
    const boundaries = safeBoundaries(messages, pinned);
    return [...head, ...messages.slice(boundaries[boundaries.length - 1] ?? pinned)];
}

/**
 * Indexes where the conversation can be cut without separating a tool call from its
 * result: before any message that is not a tool-result message.
 */
function safeBoundaries(messages: readonly ChatMessageLike[], pinned: number): number[] {
    const boundaries: number[] = [];
    for (let index = pinned + 1; index < messages.length; index++) {
        if (!messages[index].content.some(isToolResult)) {
            boundaries.push(index);
        }
    }
    return boundaries;
}

/** How a summary of compacted turns is given to the model. */
export function summaryBlock(summary: string): string {
    return `<conversation-summary>\nEarlier parts of this conversation were compacted. Summary:\n\n${summary}\n</conversation-summary>`;
}

export function buildTranscript(messages: readonly ChatMessageLike[]): string {
    return messages.map((message) => {
        const lines: string[] = [];
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart && part.value.trim()) {
                lines.push(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                lines.push(`[tool call] ${part.name} ${JSON.stringify(part.input)}`);
            } else if (isToolResult(part)) {
                lines.push(`[tool result] ${excerpt(toolResultText(part.content), TRANSCRIPT_RESULT_CHARS)}`);
            }
        }
        const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'Assistant' : 'User';
        return lines.length ? `${role}:\n${lines.join('\n')}` : '';
    }).filter(Boolean).join('\n\n');
}

function excerpt(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    const half = Math.floor(maxChars / 2);
    const omitted = estimateTextTokens(text.slice(half, text.length - half));
    return `${text.slice(0, half)}\n[… ${omitted} tokens truncated …]\n${text.slice(text.length - half)}`;
}

function isToolResult(part: unknown): part is vscode.LanguageModelToolResultPart {
    return part instanceof vscode.LanguageModelToolResultPart;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

