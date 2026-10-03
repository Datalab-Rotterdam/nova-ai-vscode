import * as vscode from 'vscode';
import { EXTENSION_ID } from './constants';

/**
 * Feature detection for VS Code API proposals. Nova declares them in `enabledApiProposals`,
 * but stable VS Code only enables proposals for allowlisted extensions, and accessing a
 * disabled proposal can throw. Every proposal use goes through here.
 */

/**
 * Whether VS Code enabled an API proposal for Nova. Stable VS Code removes proposals that are
 * not allowed (not allowlisted and not started with `--enable-proposed-api`) from the
 * extension description, and then throws when proposal-only fields are used, e.g. `editTools`
 * on a model, which would break the whole model list.
 */
export function isProposalEnabled(name: string): boolean {
    const proposals = probe(() => vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.enabledApiProposals as unknown);
    return Array.isArray(proposals) && proposals.some((proposal) => typeof proposal === 'string' && proposal.split('@')[0] === name);
}

type ThinkingPartConstructor = new (value: string | string[], id?: string, metadata?: Record<string, unknown>) => object;

function probe<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch {
        return undefined;
    }
}

/** `LanguageModelThinkingPart` from the `languageModelThinkingPart` proposal. */
export function getThinkingPartConstructor(): ThinkingPartConstructor | undefined {
    if (!isProposalEnabled('languageModelThinkingPart')) {
        return undefined;
    }
    const ctor = probe(() => (vscode as unknown as Record<string, unknown>).LanguageModelThinkingPart);
    return typeof ctor === 'function' ? ctor as ThinkingPartConstructor : undefined;
}

export function isThinkingPart(part: unknown): part is { value: string | string[] } {
    const ctor = getThinkingPartConstructor();
    return Boolean(ctor && part instanceof ctor);
}

/** `LanguageModelChatMessageRole.System` from the `languageModelSystem` proposal. */
export function getSystemRole(): vscode.LanguageModelChatMessageRole | undefined {
    if (!isProposalEnabled('languageModelSystem')) {
        return undefined;
    }
    const role = probe(() => (vscode.LanguageModelChatMessageRole as unknown as Record<string, unknown>).System);
    return typeof role === 'number' ? role as vscode.LanguageModelChatMessageRole : undefined;
}

/** `ChatResponseStream.usage` from the `chatParticipantAdditions` proposal. */
export function reportUsage(stream: vscode.ChatResponseStream, usage: vscode.ChatResultUsage): void {
    if (!isProposalEnabled('chatParticipantAdditions')) {
        return;
    }
    probe(() => typeof stream.usage === 'function' ? stream.usage(usage) : undefined);
}

/** `ChatResponseStream.thinkingProgress` from the `chatParticipantAdditions` proposal. */
export function reportThinking(stream: vscode.ChatResponseStream, text: string, id: string): void {
    if (!isProposalEnabled('chatParticipantAdditions')) {
        return;
    }
    probe(() => typeof stream.thinkingProgress === 'function' ? stream.thinkingProgress({ text, id }) : undefined);
}

/** Tools enabled in the chat tool picker (`ChatRequest.tools`, `chatParticipantAdditions` proposal). */
export function getEnabledRequestTools(request: vscode.ChatRequest): vscode.LanguageModelToolInformation[] | undefined {
    if (!isProposalEnabled('chatParticipantAdditions')) {
        return undefined;
    }
    const tools = probe(() => request.tools);
    if (!(tools instanceof Map)) {
        return undefined;
    }
    return Array.from(tools.entries()).filter(([, enabled]) => enabled).map(([tool]) => tool);
}
