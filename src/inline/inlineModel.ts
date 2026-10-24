import * as vscode from 'vscode';

/** The part of the Nova client inline features use: one non-streaming chat completion. */
export interface InlineClient {
    chat: { completions: { create(request: Record<string, unknown> & { model: string; messages: unknown[] }, options?: { signal?: AbortSignal }): Promise<{ choices: Array<{ message?: { content?: unknown } }> }> } };
}

export interface CompleteOptions {
    maxTokens: number;
    stop?: string[];
    signal?: AbortSignal;
    /** Text the answer will largely repeat (the selection being edited); lets the provider answer faster. */
    prediction?: string;
}

/**
 * One answer for an inline feature. The gateway has no fill-in-the-middle endpoint, so
 * completions and edits go through chat completions with a strict prompt; the answer is
 * cleaned of thinking and code fences a chat model may still add.
 */
export async function complete(client: InlineClient, model: string, system: string, user: string, options: CompleteOptions): Promise<string> {
    const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: options.maxTokens,
        temperature: 0,
        ...(options.stop?.length ? { stop: options.stop } : {}),
        ...(options.prediction ? { prediction: { type: 'content', content: options.prediction } } : {})
    }, { signal: options.signal });
    const content = response.choices[0]?.message?.content;
    return stripFences(typeof content === 'string' ? content : '');
}

/** The answer without `<think>` blocks and without a code fence around all of it. */
export function stripFences(text: string): string {
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
    const fenced = /^\s*```[\w+-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(cleaned);
    return fenced ? fenced[1] : cleaned;
}

/** `nova.inline.model`: the model for inline edits and completions; empty turns them off. */
export function inlineModel(): string | undefined {
    return vscode.workspace.getConfiguration('nova').get<string>('inline.model', '').trim() || undefined;
}
