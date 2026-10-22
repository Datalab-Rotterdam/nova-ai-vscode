import { describe, expect, it } from 'vitest';
import { classifyFile, isOnlyFileUris, parseDroppedUris } from '../src/panel/drop';

const source = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (type: string) => data[type] ?? '' });

describe('parseDroppedUris', () => {
    it('reads the Explorer resourceurls JSON', () => {
        expect(parseDroppedUris(source({ resourceurls: JSON.stringify(['file:///a/b.ts', 'vscode-remote://x/y']) }))).toEqual(['file:///a/b.ts']);
    });

    it('reads text/uri-list, skipping comments and non-file URIs', () => {
        expect(parseDroppedUris(source({ 'text/uri-list': '# note\r\nfile:///a/b.ts\r\nhttps://example.com\r\nfile:///c.md' }))).toEqual(['file:///a/b.ts', 'file:///c.md']);
    });

    it('falls back to plain text and dedupes across types', () => {
        expect(parseDroppedUris(source({ 'text/uri-list': 'file:///a.ts', 'text/plain': 'file:///a.ts' }))).toEqual(['file:///a.ts']);
    });

    it('ignores ordinary text and broken JSON', () => {
        expect(parseDroppedUris(source({ resourceurls: 'nope', 'text/plain': 'hello world' }))).toEqual([]);
    });
});

describe('isOnlyFileUris', () => {
    it('accepts file URIs only', () => {
        expect(isOnlyFileUris('file:///a.ts\nfile:///b.ts')).toBe(true);
        expect(isOnlyFileUris('see file:///a.ts')).toBe(false);
        expect(isOnlyFileUris('')).toBe(false);
    });
});

describe('classifyFile', () => {
    it('sorts images, text and binaries', () => {
        expect(classifyFile('shot.PNG')).toBe('image');
        expect(classifyFile('x', 'image/webp')).toBe('image');
        expect(classifyFile('notes.md')).toBe('text');
        expect(classifyFile('Makefile')).toBe('text');
        expect(classifyFile('doc.pdf')).toBe('unsupported');
        expect(classifyFile('anim.gif', 'image/gif')).toBe('unsupported');
    });
});
