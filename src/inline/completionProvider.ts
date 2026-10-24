import * as vscode from 'vscode';
import { complete, inlineModel, type InlineClient } from './inlineModel';

const PREFIX_LINES = 60;
const SUFFIX_LINES = 20;
const MAX_TOKENS = 128;
const CACHE_SIZE = 50;

const SYSTEM = [
    'You complete code. The user sends a file excerpt with <CURSOR> where the cursor is.',
    'Reply with only the text to insert at <CURSOR>: no explanation, no code fences, and nothing that is already before or after the cursor.',
    'Insert a natural continuation of at most a few lines; reply with nothing when no completion fits.'
].join('\n');

/**
 * Ghost-text completions (Tab), off by default: `nova.inline.tabEnabled` and a model in
 * `nova.inline.model`. Each pause in typing sends the code around the cursor to the gateway,
 * so requests wait for a pause (`nova.inline.debounceMs`) and repeat answers come from a cache.
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private readonly cache = new Map<string, string>();

    public constructor(private readonly client: () => Promise<InlineClient | undefined>) {
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const config = vscode.workspace.getConfiguration('nova');
        const model = inlineModel();
        // The suggest widget is open: VS Code shows our text only when it matches its pick.
        if (!model || !config.get<boolean>('inline.tabEnabled', false) || context.selectedCompletionInfo) {
            return undefined;
        }
        const line = document.lineAt(position.line).text;
        const linePrefix = line.slice(0, position.character);
        // Mid-line (code after the cursor that is not just closing brackets): complete the line only.
        const singleLine = /[^\s)\]}'"`;,]/.test(line.slice(position.character));
        const prefix = document.getText(new vscode.Range(new vscode.Position(Math.max(0, position.line - PREFIX_LINES), 0), position));
        const lastLine = Math.min(document.lineCount - 1, position.line + SUFFIX_LINES);
        const suffix = document.getText(new vscode.Range(position, new vscode.Position(lastLine, document.lineAt(lastLine).text.length)));

        const key = `${document.languageId}\0${prefix.slice(-500)}\0${suffix.slice(0, 200)}`;
        let text = this.cache.get(key);
        if (text === undefined) {
            if (!await pause(config.get<number>('inline.debounceMs', 300), token)) {
                return undefined;
            }
            const client = await this.client();
            if (!client || token.isCancellationRequested) {
                return undefined;
            }
            const controller = new AbortController();
            const cancel = token.onCancellationRequested(() => controller.abort());
            try {
                text = await complete(client, model, SYSTEM, `Language: ${document.languageId}\n${prefix}<CURSOR>${suffix}`, {
                    maxTokens: MAX_TOKENS,
                    stop: singleLine ? ['\n'] : ['\n\n\n'],
                    signal: controller.signal
                });
            } catch {
                return undefined;
            } finally {
                cancel.dispose();
            }
            text = cleanCompletion(text, linePrefix, singleLine);
            remember(this.cache, key, text);
        }
        return text ? [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))] : undefined;
    }
}

/** A completion without what the model repeated from the line, and one line long mid-line. */
export function cleanCompletion(text: string, linePrefix: string, singleLine: boolean): string {
    let cleaned = text.replace(/<CURSOR>/g, '');
    const typed = linePrefix.trimStart();
    if (typed && cleaned.startsWith(typed)) {
        cleaned = cleaned.slice(typed.length);
    }
    if (singleLine) {
        cleaned = cleaned.split('\n')[0];
    }
    return cleaned.trim() ? cleaned.replace(/\s+$/, '') : '';
}

/** Waits `ms`; false when the request was cancelled meanwhile (the user typed on). */
function pause(ms: number, token: vscode.CancellationToken): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            subscription.dispose();
            resolve(!token.isCancellationRequested);
        }, ms);
        const subscription = token.onCancellationRequested(() => {
            clearTimeout(timer);
            subscription.dispose();
            resolve(false);
        });
    });
}

/** ponytail: Map insertion order as the LRU; a hit does not move an entry to the front. */
function remember(cache: Map<string, string>, key: string, value: string): void {
    cache.set(key, value);
    if (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value!);
    }
}
