import { describe, expect, it } from 'vitest';
import { selectPassages } from '../src/agent/tools/passages';
import { formatSearchOutput, type Page, type WebResult } from '../src/agent/tools/webSearch';

describe('selectPassages', () => {
    it('returns the text unchanged when it fits the limit', () => {
        expect(selectPassages('short text', 'query', 100)).toBe('short text');
    });

    it('keeps the blocks that match the query and drops the rest', () => {
        const filler = ' '.repeat(100).split('').join('x ');
        const text = [
            filler,
            'Some interesting fact about walruses and their tusks.',
            filler,
            'Generic padding text that matches nothing at all, but is long enough to stand alone as its own block. '.repeat(3),
            'Another fact about walrus habitats in the Arctic.'
        ].join('\n\n');
        const chosen = selectPassages(text, 'walrus tusks habitat', 900);
        expect(chosen).toContain('walruses and their tusks');
        expect(chosen).toContain('walrus habitats');
        expect(chosen).not.toContain('matches nothing');
    });

    it('falls back to the start of the page when nothing matches', () => {
        const text = 'First words here.\n\n' + 'y'.repeat(500);
        const chosen = selectPassages(text, 'zzz not present', 100);
        expect(chosen).toContain('First words here.');
        expect(chosen.length).toBeLessThanOrEqual(100);
    });

    it('compares words without accents', () => {
        const text = 'a'.repeat(300) + '\n\nThe café serves croissants.\n\n' + 'b'.repeat(300);
        expect(selectPassages(text, 'cafée croissants', 400)).toContain('café');
    });

    it('marks gaps between far-apart matches', () => {
        const filler = ' '.repeat(300).split('').join('p ');
        const text = 'alpha match here\n\n' + filler + '\n\nbeta match here';
        const chosen = selectPassages(text, 'alpha beta', 800);
        expect(chosen).toMatch(/…\n/);
    });
});

describe('formatSearchOutput', () => {
    const results: WebResult[] = [
        { title: 'Example', url: 'https://a.test', snippet: 'snippet a' },
        { title: 'Other', url: 'https://b.test', snippet: 'snippet b' }
    ];

    it('numbers sources and includes their opened passages', () => {
        const pages = new Map<string, Page | undefined>([
            ['https://a.test', { url: 'https://a.test', title: 'Example', text: 'x'.repeat(500) + '\n\nThe matching answer here.\n\n' + 'y'.repeat(500) }],
            ['https://b.test', undefined]
        ]);
        const output = formatSearchOutput('You.com', 'the question', results, pages);
        expect(output.text).toContain('[1] Example');
        expect(output.text).toContain('[2] Other');
        expect(output.text).toContain('The matching answer here.');
        expect(output.text).toContain('snippet b');
        expect(output.text).toContain('Cite the sources below as [1], [2], …');
        expect(output.images).toEqual([]);
    });

    it('uses snippets for pages that were not opened', () => {
        const output = formatSearchOutput('DuckDuckGo', 'q', results, new Map());
        expect(output.text).toContain('snippet a');
        expect(output.text).toContain('snippet b');
    });
});
