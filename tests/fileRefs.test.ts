import { describe, expect, it } from 'vitest';
import { looksLikeFilePath, splitFileRef } from '../src/panel/fileRefs';

describe('splitFileRef', () => {
    it('reads the position after a path', () => {
        expect(splitFileRef('src/a.ts')).toEqual({ path: 'src/a.ts' });
        expect(splitFileRef('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
        expect(splitFileRef('src/a.ts:12:5')).toEqual({ path: 'src/a.ts', line: 12, column: 5 });
        expect(splitFileRef('src/a.ts:12-20')).toEqual({ path: 'src/a.ts', line: 12 });
        expect(splitFileRef('src/a.ts#L7-L9')).toEqual({ path: 'src/a.ts', line: 7 });
        expect(splitFileRef('C:\\repo\\a.ts:3')).toEqual({ path: 'C:\\repo\\a.ts', line: 3 });
    });
});

describe('looksLikeFilePath', () => {
    it('accepts paths and file names with a known extension', () => {
        for (const text of ['src/panel/links.ts', 'package.json', './a/b.md', '../x.py:10', '~/notes.txt', '/Users/me/report.pdf', 'C:\\repo\\a.ts', 'Dockerfile.yml']) {
            expect(looksLikeFilePath(text), text).toBe(true);
        }
    });

    it('rejects code, URLs, versions and ordinary words', () => {
        for (const text of ['console.log', 'Object.keys(a)', 'https://example.com/a.ts', '1.2.3', 'e.g.', 'foo bar.ts', 'a = b.ts', '*.ts', 'src/', 'README', '']) {
            expect(looksLikeFilePath(text), text).toBe(false);
        }
    });
});
