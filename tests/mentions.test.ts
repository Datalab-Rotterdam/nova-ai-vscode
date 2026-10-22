import { describe, expect, it } from 'vitest';
import { filterMentionFiles, findMention } from '../src/panel/mentions';

describe('mention detection', () => {
  it('finds the token at the caret, starting it at line start', () => {
    expect(findMention('see @abc', 8)).toEqual({ start: 4, query: 'abc' });
    expect(findMention('@abc', 4)).toEqual({ start: 0, query: 'abc' });
    expect(findMention('@abc\nmore', 4)).toEqual({ start: 0, query: 'abc' });
    expect(findMention('plain words', 5)).toBeUndefined();
  });

  it('does not fire inside words', () => {
    expect(findMention('user@example.com', 10)).toBeUndefined();
    expect(findMention('a@b@c', 5)).toBeUndefined();
  });

  it('ends when the token holds a space or backquote but not a slash', () => {
    expect(findMention('see @abc def', 14)).toBeUndefined();
    expect(findMention('see @a/b c', 11)).toBeUndefined();
    // Paths are typed in, so a natural `@src/agent/…` stays a live mention.
    expect(findMention('see @src/x', 10)).toEqual({ start: 4, query: 'src/x' });
    expect(findMention('see `a` @n', 10)).toEqual({ start: 8, query: 'n' });
    expect(findMention('see `@x', 9)).toBeUndefined();
    expect(findMention('see @a`b', 10)).toBeUndefined();
  });
});

describe('mention file filtering', () => {
  const options = [
    'deep/nested/gamma.ts',
    'b.txt',
    'alpha.ts',
    'deep/gamma.ts',
    'gamma.ts',
    'a.txt'
  ];

  it('keeps input order for an empty query', () => {
    expect(filterMentionFiles(options, '')).toEqual(options);
  });

  it('ranks name matches before path-only matches', () => {
    expect(filterMentionFiles(options, 'gamma')).toEqual(['gamma.ts', 'deep/gamma.ts', 'deep/nested/gamma.ts']);
    expect(filterMentionFiles(options, 'deep/gamma')).toEqual(['deep/gamma.ts']);
  });

  it('keeps shorter paths and alphabetical order as ties', () => {
    expect(filterMentionFiles(options, 'g')).toEqual(['gamma.ts', 'deep/gamma.ts', 'deep/nested/gamma.ts']);
  });

  it('drops what does not match and caps the list', () => {
    expect(filterMentionFiles(options, 'zzz')).toEqual([]);
    const many = options.map((_path, index) => `${index}/x.txt`);
    expect(filterMentionFiles(many, 'x.txt', 3)).toHaveLength(3);
  });
});
