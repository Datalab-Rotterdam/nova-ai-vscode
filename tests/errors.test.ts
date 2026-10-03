import { describe, expect, it } from 'vitest';
import { NovaAIError } from '@datalabrotterdam/nova-sdk';
import { isToolCallingRejected, mapNovaError } from '../src/core/errors';

describe('novaErrors', () => {
  it('maps auth errors to NoPermissions', () => {
    const error = new NovaAIError('Bad key', {
      status: 401,
      body: {},
      response: new Response(),
      requestId: 'req-1',
      configId: null,
      type: null,
      code: null
    });

    const mapped = mapNovaError(error);
    expect(mapped).toBeInstanceOf(Error);
    expect((mapped as Error & { code?: string }).code).toBe('NoPermissions');
    expect(mapped.message).toContain('req-1');
  });

  it('detects tool calling rejections', () => {
    const error = new NovaAIError('tool payload rejected', {
      status: 400,
      body: {},
      response: new Response(),
      requestId: null,
      configId: null,
      type: null,
      code: 'invalid_request'
    });

    expect(isToolCallingRejected(error)).toBe(true);
  });
});


describe('context overflow detection', () => {
  it('recognizes overflow messages from common servers and parses the limit', async () => {
    const { isContextOverflow, parseContextLimit } = await import('../src/core/errors');
    const vllm = new Error("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens.");
    const generic = new Error('prompt is too long');

    expect(isContextOverflow(vllm)).toBe(true);
    expect(isContextOverflow(generic)).toBe(true);
    expect(isContextOverflow(new Error('rate limited'))).toBe(false);
    expect(parseContextLimit(vllm)).toBe(32768);
    expect(parseContextLimit(generic)).toBeUndefined();
  });
});
