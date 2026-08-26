import { describe, expect, it } from 'vitest';
import { estimateTokenCount } from '../src/model/tokenEstimator';

describe('estimateTokenCount', () => {
  it('uses a conservative UTF-8 byte estimate for ASCII text', () => {
    expect(estimateTokenCount('abcdefghijkl')).toBe(4);
  });

  it('accounts for the larger byte size of multilingual text', () => {
    expect(estimateTokenCount('你好世界')).toBe(4);
  });

  it('returns at least one token', () => {
    expect(estimateTokenCount('')).toBe(1);
  });
});
