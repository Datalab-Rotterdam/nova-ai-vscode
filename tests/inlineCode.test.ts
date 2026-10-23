import { describe, expect, it } from 'vitest';
import { highlightInline, tokenizeInline } from '../src/panel/inlineCode';

const kinds = (code: string) => tokenizeInline(code).filter((token) => token.kind).map((token) => [token.text, token.kind]);

describe('inline code highlighting', () => {
    it('marks keywords, literals, numbers, strings and calls', () => {
        expect(kinds('const x = foo(42, "a b", true)')).toEqual([
            ['const', 'keyword'], ['foo', 'fn'], ['42', 'number'], ['"a b"', 'string'], ['true', 'literal']
        ]);
    });

    it('marks flags and type names, and leaves plain snippets alone', () => {
        expect(kinds('npm install --save-dev Foo')).toEqual([['--save-dev', 'flag'], ['Foo', 'type']]);
        expect(highlightInline('src/app.ts')).toBe('src/app.ts');
        expect(highlightInline('foo')).toBe('foo');
    });

    it('keeps the snippet intact and escapes it', () => {
        const code = 'a < b && c("<i>") // x & y';
        expect(tokenizeInline(code).map((token) => token.text).join('')).toBe(code);
        const html = highlightInline(code);
        expect(html).not.toContain('<i>');
        expect(html).toContain('hl-comment');
    });

    it('does not take a hyphen in a word or a minus for a flag', () => {
        expect(kinds('well-known a - b')).toEqual([]);
    });
});
