import * as vscode from 'vscode';
import { EXTENSION_ID } from '../core/constants';
import type { LanguageModelInfo } from '../core/types';
import type { ModelProvider } from '../model/modelProvider';

/**
 * A `LanguageModelChat` that calls Nova's provider directly. The Nova chat panel uses it
 * instead of `vscode.lm.selectChatModels`, so it works regardless of which models the
 * user made visible in VS Code's model picker and before VS Code has resolved them.
 */
export function createDirectModel(provider: ModelProvider, info: LanguageModelInfo): vscode.LanguageModelChat {
    return {
        id: info.id,
        name: info.name,
        vendor: 'nova-ai',
        family: info.family,
        version: info.version,
        maxInputTokens: info.maxInputTokens,
        countTokens: (text: string | vscode.LanguageModelChatMessage, token?: vscode.CancellationToken) =>
            provider.provideTokenCount(info, text as string, token ?? new vscode.CancellationTokenSource().token),
        sendRequest: async (messages, options = {}, token) => {
            const queue = new PartQueue();
            const done = provider.provideLanguageModelChatResponse(
                info,
                messages as unknown as vscode.LanguageModelChatRequestMessage[],
                {
                    tools: options.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
                    toolMode: options.toolMode ?? vscode.LanguageModelChatToolMode.Auto,
                    modelOptions: options.modelOptions,
                    requestInitiator: EXTENSION_ID
                } as vscode.ProvideLanguageModelChatResponseOptions,
                { report: (part) => queue.push(part) },
                token ?? new vscode.CancellationTokenSource().token
            ).then(() => queue.close(), (error: unknown) => queue.fail(error));

            // Surface errors that happen before streaming starts (auth, overflow) from sendRequest itself,
            // as `vscode.lm` does, so callers can retry.
            const first = await queue.peek();
            if (first.error) {
                await done;
                throw first.error;
            }

            const stream = queue.iterate();
            return {
                stream,
                text: (async function* () {
                    for await (const part of queue.iterateText()) {
                        yield part;
                    }
                })()
            } as vscode.LanguageModelChatResponse;
        }
    } as vscode.LanguageModelChat;
}

/** Single-consumer async queue bridging `Progress.report` to an async iterable. */
class PartQueue {
    private readonly parts: unknown[] = [];
    private closed = false;
    private error: unknown;
    private wake?: () => void;

    public push(part: unknown): void {
        this.parts.push(part);
        this.notify();
    }

    public close(): void {
        this.closed = true;
        this.notify();
    }

    public fail(error: unknown): void {
        this.error = error ?? new Error('Nova AI request failed.');
        this.closed = true;
        this.notify();
    }

    /** Waits until the first part arrives or the request ends. */
    public async peek(): Promise<{ error?: unknown }> {
        while (!this.parts.length && !this.closed) {
            await new Promise<void>((resolve) => (this.wake = resolve));
        }
        return { error: this.parts.length ? undefined : this.error };
    }

    public async *iterate(): AsyncIterable<unknown> {
        for (;;) {
            if (this.parts.length) {
                yield this.parts.shift();
                continue;
            }
            if (this.closed) {
                if (this.error) {
                    throw this.error;
                }
                return;
            }
            await new Promise<void>((resolve) => (this.wake = resolve));
        }
    }

    public async *iterateText(): AsyncIterable<string> {
        for await (const part of this.iterate()) {
            if (part instanceof vscode.LanguageModelTextPart) {
                yield part.value;
            }
        }
    }

    private notify(): void {
        const wake = this.wake;
        this.wake = undefined;
        wake?.();
    }
}
