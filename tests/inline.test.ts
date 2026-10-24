import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanCompletion, InlineCompletionProvider } from '../src/inline/completionProvider';
import { buildEditPrompt } from '../src/inline/editInPlace';
import { complete, stripFences } from '../src/inline/inlineModel';

/** Enough of a TextDocument for the inline features: lines, getText over a range. */
function doc(text: string, languageId = 'typescript'): vscode.TextDocument {
    const lines = text.split('\n');
    const offset = (position: vscode.Position) => lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
    return {
        languageId,
        uri: vscode.Uri.file('/repo/src/a.ts'),
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line], range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lines[line].length)) }),
        getText: (range?: vscode.Range) => range ? text.slice(offset(range.start), offset(range.end)) : text
    } as unknown as vscode.TextDocument;
}

function settings(values: Record<string, unknown>) {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: <T>(key: string, fallback: T) => (key in values ? values[key] : fallback) as T } as never);
}

const token = () => new vscode.CancellationTokenSource();

afterEach(() => {
    vi.restoreAllMocks();
});

describe('inline model answers', () => {
    it('drops thinking and a code fence around the answer', () => {
        expect(stripFences('<think>hmm</think>\n```ts\nconst a = 1;\n```')).toBe('const a = 1;');
        expect(stripFences('return x;')).toBe('return x;');
    });

    it('sends one non-streaming request with the prediction and stop sequences', async () => {
        const create = vi.fn(async () => ({ choices: [{ message: { content: '```\nfoo()\n```' } }] }));
        expect(await complete({ chat: { completions: { create } } }, 'fast', 'sys', 'user', { maxTokens: 64, stop: ['\n'], prediction: 'old' })).toBe('foo()');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'fast', max_tokens: 64, stop: ['\n'], prediction: { type: 'content', content: 'old' }, temperature: 0 }), expect.anything());
    });

    it('cleans a completion: no repeated line start, one line mid-line', () => {
        expect(cleanCompletion('const total = a + b;', '  const total = ', false)).toBe('a + b;');
        expect(cleanCompletion('a + b);\nmore()', 'f(', true)).toBe('a + b);');
        expect(cleanCompletion('   \n', 'x', false)).toBe('');
    });
});

describe('Tab completions', () => {
    const document = doc('function add(a, b) {\n  return \n}\n');
    const position = new vscode.Position(1, 9);
    const context = { triggerKind: 1, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext;

    it('stay off without tabEnabled and a model', async () => {
        const client = vi.fn();
        settings({ 'inline.model': 'fast', 'inline.tabEnabled': false });
        expect(await new InlineCompletionProvider(client).provideInlineCompletionItems(document, position, context, token().token)).toBeUndefined();
        settings({ 'inline.tabEnabled': true });
        expect(await new InlineCompletionProvider(client).provideInlineCompletionItems(document, position, context, token().token)).toBeUndefined();
        expect(client).not.toHaveBeenCalled();
    });

    it('wait for a pause, send the code around the cursor, and cache the answer', async () => {
        settings({ 'inline.model': 'fast', 'inline.tabEnabled': true, 'inline.debounceMs': 1 });
        const create = vi.fn(async () => ({ choices: [{ message: { content: 'a + b;' } }] }));
        const provider = new InlineCompletionProvider(async () => ({ chat: { completions: { create } } }));

        const items = await provider.provideInlineCompletionItems(document, position, context, token().token);
        expect(items?.[0].insertText).toBe('a + b;');
        expect(JSON.stringify(create.mock.calls[0])).toContain('return <CURSOR>\\n}');
        await provider.provideInlineCompletionItems(document, position, context, token().token);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('send nothing when the user types on before the pause ends', async () => {
        settings({ 'inline.model': 'fast', 'inline.tabEnabled': true, 'inline.debounceMs': 50 });
        const client = vi.fn();
        const source = token();
        const pending = new InlineCompletionProvider(client).provideInlineCompletionItems(document, position, context, source.token);
        source.cancel();
        expect(await pending).toBeUndefined();
        expect(client).not.toHaveBeenCalled();
    });
});

describe('edit in place', () => {
    it('sends the selection between tags with the code around it and the instruction', () => {
        const document = doc('a\nb\nselected\nc\n', 'python');
        const range = new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 8));
        expect(buildEditPrompt(document, range, 'uppercase it')).toBe('File: /repo/src/a.ts (python)\na\nb\n<selection>selected</selection>\nc\n\n\nInstruction: uppercase it');
    });
});
