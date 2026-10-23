import { describe, expect, it } from 'vitest';
import { customizationRules, parseJsonc, resolveSyntaxColors } from '../src/views/syntaxColors';

describe('resolveSyntaxColors', () => {
    it('gives each role the most specific matching rule, the later one on a tie', () => {
        const colors = resolveSyntaxColors([
            { scope: 'keyword', settings: { foreground: '#111111' } },
            { scope: ['keyword.control', 'storage.type'], settings: { foreground: '#222222' } },
            { scope: 'string', settings: { foreground: '#333333' } },
            { scope: 'string', settings: { foreground: '#444444' } },
            { scope: 'comment, punctuation.definition.comment', settings: { foreground: '#555555' } }
        ]);
        expect(colors).toMatchObject({ keyword: '#222222', string: '#444444', comment: '#555555' });
    });

    it('falls back to a broader scope, and leaves a role empty when the theme has no rule', () => {
        const colors = resolveSyntaxColors([{ scope: 'constant', settings: { foreground: '#abcdef' } }]);
        expect(colors.number).toBe('#abcdef');
        expect(colors.literal).toBe('#abcdef');
        expect(colors.keyword).toBeUndefined();
    });

    it('ignores descendant selectors and anything that is not a plain hex color', () => {
        const colors = resolveSyntaxColors([
            { scope: 'source.js string', settings: { foreground: '#123456' } },
            { scope: 'keyword', settings: { foreground: 'red; background: url(x)' } },
            { scope: 'comment', settings: { foreground: '#12345678' } }
        ]);
        expect(colors.string).toBeUndefined();
        expect(colors.keyword).toBeUndefined();
        expect(colors.comment).toBe('#12345678');
    });
});

describe('customizationRules', () => {
    it('reads shortcuts, text mate rules and the sections of the current theme', () => {
        const rules = customizationRules({
            comments: '#aaaaaa',
            strings: { foreground: '#bbbbbb' },
            textMateRules: [{ scope: 'keyword', settings: { foreground: '#cccccc' } }],
            '[Other]': { comments: '#000000' },
            '[My Theme][Dark]': { comments: '#dddddd' }
        }, 'My Theme');
        expect(resolveSyntaxColors(rules)).toMatchObject({ comment: '#dddddd', string: '#bbbbbb', keyword: '#cccccc' });
        expect(customizationRules(undefined, 'x')).toEqual([]);
    });
});

describe('parseJsonc', () => {
    it('accepts comments and trailing commas, and leaves strings alone', () => {
        const parsed = parseJsonc(`﻿{
            // line comment
            "url": "http://example.com/*not a comment*/", /* block */
            "list": [1, 2,],
            "text": "a \\"quoted\\" // value",
        }`);
        expect(parsed).toEqual({ url: 'http://example.com/*not a comment*/', list: [1, 2], text: 'a "quoted" // value' });
    });
});
