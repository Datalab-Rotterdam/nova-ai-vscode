import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createDirectModel } from '../src/panel/directModel';
import { providerInternals } from '../src/model/modelProvider';

const info = providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova', context_window: 32_768 });

describe('direct Nova model for the chat panel', () => {
  it('streams parts reported by the provider and forwards tools', async () => {
    const provider = {
      provideLanguageModelChatResponse: vi.fn(async (_model, _messages, _options, progress: vscode.Progress<unknown>) => {
        progress.report(new vscode.LanguageModelTextPart('Hello'));
        await new Promise((resolve) => setTimeout(resolve, 5));
        progress.report(new vscode.LanguageModelToolCallPart('c1', 'read_file', {}));
      })
    };
    const model = createDirectModel(provider as never, info);
    const tool = { name: 'read_file', description: 'Reads', inputSchema: { type: 'object' }, tags: [] };

    const response = await model.sendRequest([vscode.LanguageModelChatMessage.User('hi')] as never, { tools: [tool] }, vscode.CancellationToken.None as never);
    const parts: unknown[] = [];
    for await (const part of response.stream) {
      parts.push(part);
    }

    expect(parts).toHaveLength(2);
    expect(provider.provideLanguageModelChatResponse.mock.calls[0][2]).toMatchObject({
      tools: [{ name: 'read_file', description: 'Reads', inputSchema: { type: 'object' } }],
      requestInitiator: 'datalabrotterdam.nova-ai-vscode'
    });
    expect(model.maxInputTokens).toBe(info.maxInputTokens);
  });

  it('rejects sendRequest when the provider fails before streaming', async () => {
    const provider = { provideLanguageModelChatResponse: vi.fn().mockRejectedValue(new Error('maximum context length is 8192 tokens')) };
    const model = createDirectModel(provider as never, info);

    await expect(model.sendRequest([], {}, vscode.CancellationToken.None as never)).rejects.toThrow('maximum context length');
  });

  it('surfaces errors after streaming started through the stream', async () => {
    const provider = {
      provideLanguageModelChatResponse: vi.fn(async (_model, _messages, _options, progress: vscode.Progress<unknown>) => {
        progress.report(new vscode.LanguageModelTextPart('partial'));
        throw new Error('connection reset');
      })
    };
    const response = await createDirectModel(provider as never, info).sendRequest([], {}, vscode.CancellationToken.None as never);

    await expect((async () => {
      for await (const _part of response.stream) {
        // drain
      }
    })()).rejects.toThrow('connection reset');
  });
});

describe('chat model filter', () => {
  const model = (capabilities?: string[], tags?: string[]) => ({ id: 'm', object: 'model', created: 1, owned_by: 'nova', capabilities, tags });

  it('drops embedding, speech and transcription models (capabilities as Nova reports them)', () => {
    expect(providerInternals.isChatModel(model(['embeddings']))).toBe(false);
    expect(providerInternals.isChatModel(model(['audio_synthesis']))).toBe(false);
    expect(providerInternals.isChatModel(model(['audio_transcription']))).toBe(false);
  });

  it('keeps chat models and models without capability information', () => {
    expect(providerInternals.isChatModel(model(['function_calling', 'text', 'vision']))).toBe(true);
    expect(providerInternals.isChatModel(model(['function_calling', 'reasoning', 'text']))).toBe(true);
    expect(providerInternals.isChatModel(model())).toBe(true);
  });
});
