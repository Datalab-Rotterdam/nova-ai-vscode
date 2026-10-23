/*
 * Syntax colors for `inline code` in chat answers. An inline snippet has no language tag, so
 * this is one small tokenizer for the things most languages share (strings, numbers, keywords,
 * calls, type names, comments, flags) instead of language detection. A snippet without any of
 * them, like `foo` or `src/app.ts`, stays plain. The colors come from the VS Code theme (see
 * Markdown.svelte); this only marks the tokens.
 */

const KEYWORDS = [
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default', 'defer',
    'do', 'elif', 'else', 'enum', 'except', 'export', 'extends', 'finally', 'fn', 'for', 'from', 'func', 'function',
    'if', 'impl', 'implements', 'import', 'in', 'interface', 'is', 'let', 'match', 'mut', 'new', 'package', 'private',
    'protected', 'pub', 'public', 'return', 'self', 'static', 'struct', 'super', 'switch', 'this', 'throw', 'trait',
    'try', 'type', 'use', 'var', 'void', 'while', 'with', 'yield'
];
const LITERALS = ['true', 'false', 'null', 'nil', 'undefined', 'None', 'True', 'False', 'NaN'];

const TOKEN = new RegExp(
    [
        String.raw`(?<string>"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)`,
        String.raw`(?<comment>//.*|/\*.*?(?:\*/|$))`,
        String.raw`(?<number>\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)`,
        String.raw`(?<flag>(?<![\w-])--?[a-zA-Z][\w-]*)`,
        String.raw`(?<word>[A-Za-z_$][\w$]*)`
    ].join('|'),
    'g'
);

export type InlineClass = 'string' | 'comment' | 'number' | 'flag' | 'keyword' | 'literal' | 'fn' | 'type';

export interface InlineToken {
    text: string;
    /** Absent for plain text. */
    kind?: InlineClass;
}

/** Splits a snippet into tokens that, put back to back, are the snippet again. */
export function tokenizeInline(code: string): InlineToken[] {
    const tokens: InlineToken[] = [];
    let last = 0;
    const plain = (end: number) => {
        if (end > last) {
            tokens.push({ text: code.slice(last, end) });
        }
    };
    for (const match of code.matchAll(TOKEN)) {
        const groups = match.groups ?? {};
        const start = match.index ?? 0;
        const text = match[0];
        let kind: InlineClass | undefined;
        if (groups.string !== undefined) kind = 'string';
        else if (groups.comment !== undefined) kind = 'comment';
        else if (groups.number !== undefined) kind = 'number';
        else if (groups.flag !== undefined) kind = 'flag';
        else if (groups.word !== undefined) {
            if (KEYWORDS.includes(text)) kind = 'keyword';
            else if (LITERALS.includes(text)) kind = 'literal';
            else if (code[start + text.length] === '(') kind = 'fn';
            else if (/^[A-Z][a-z]/.test(text)) kind = 'type';
        }
        if (!kind) {
            continue;
        }
        plain(start);
        tokens.push({ text, kind });
        last = start + text.length;
    }
    plain(code.length);
    return tokens;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The HTML of an inline snippet: escaped text with a `hl-…` span around each colored token. */
export function highlightInline(code: string): string {
    return tokenizeInline(code)
        .map((token) => (token.kind ? `<span class="hl-${token.kind}">${escapeHtml(token.text)}</span>` : escapeHtml(token.text)))
        .join('');
}
