import { describe, expect, it } from 'vitest';
import { applyHunk, diffHunks, diffLines, hunkLines, revertHunk } from '../src/panel/diff';

describe('diffLines', () => {
  it('shows changed lines with context and line numbers', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n') + '\n';
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n') + '\n';
    const { lines, added, removed } = diffLines(before, after);

    expect({ added, removed }).toEqual({ added: 2, removed: 1 });
    expect(lines[0]).toEqual({ type: 'hunk', text: '@@ -2 +2 @@' });
    expect(lines.filter((line) => line.type !== 'context' && line.type !== 'hunk')).toEqual([
      { type: 'del', text: 'e', oldNo: 5, newNo: undefined },
      { type: 'add', text: 'E', oldNo: undefined, newNo: 5 },
      { type: 'add', text: 'k', oldNo: undefined, newNo: 11 }
    ]);
    // Far-apart changes get separate hunks? Here they are within context, so one hunk.
    expect(lines.filter((line) => line.type === 'hunk')).toHaveLength(1);
  });

  it('splits distant changes into hunks', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
    const after = before.replace('line 2', 'LINE 2').replace('line 25', 'LINE 25');
    expect(diffLines(before, after).lines.filter((line) => line.type === 'hunk')).toHaveLength(2);
  });

  it('handles new files, CRLF and identical content', () => {
    expect(diffLines('', 'one\ntwo\n')).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines('a\nb\n', 'x\ny\n').lines[0]).toEqual({ type: 'hunk', text: '@@ -1 +1 @@' });
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toMatchObject({ added: 0, removed: 0, lines: [] });
  });

  it('caps the number of lines shown', () => {
    const result = diffLines('', Array.from({ length: 1000 }, (_, index) => `${index}`).join('\n'), 50);
    expect(result.lines).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.added).toBe(1000);
  });
});

describe('hunks', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\n';
    const after = 'a\nB\nc\nd\ne\nf2\nf3\ng\nh\n';

    it('splits a change into hunks that can each be kept or undone', () => {
        const hunks = diffHunks(before, after);
        expect(hunks.map((hunk) => [hunk.removed, hunk.added])).toEqual([[['b'], ['B']], [['f'], ['f2', 'f3']], [[], ['h']]]);
        // Keeping or undoing hunks one at a time (recomputed in between) ends at the new or the old text.
        let baseline = before;
        while (diffHunks(baseline, after).length) {
            baseline = applyHunk(baseline, diffHunks(baseline, after)[0]);
        }
        expect(baseline).toBe(after);
        let current = after;
        while (diffHunks(before, current).length) {
            current = revertHunk(current, diffHunks(before, current).at(-1)!);
        }
        expect(current).toBe(before);
    });

    it('keeps one hunk without touching the others, and keeps CRLF line endings', () => {
        const crlf = (text: string) => text.replace(/\n/g, '\r\n');
        const [, second] = diffHunks(crlf(before), crlf(after));
        expect(applyHunk(crlf(before), second)).toBe(crlf('a\nb\nc\nd\ne\nf2\nf3\ng\n'));
        expect(revertHunk(crlf(after), second)).toBe(crlf('a\nB\nc\nd\ne\nf\ng\nh\n'));
    });

    it('handles a new file and shows a hunk with line numbers', () => {
        const [hunk] = diffHunks('', 'x\ny\n');
        expect(revertHunk('x\ny\n', hunk)).toBe('');
        expect(hunkLines(diffHunks(before, after)[0])).toEqual([
            { type: 'hunk', text: '@@ -2 +2 @@' },
            { type: 'del', text: 'b', oldNo: 2 },
            { type: 'add', text: 'B', newNo: 2 }
        ]);
    });
});
