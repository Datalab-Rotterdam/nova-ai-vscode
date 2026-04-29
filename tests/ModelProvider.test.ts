import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ModelProvider, providerInternals } from '../src/model/modelProvider';
import { Diagnostics } from '../src/core/diagnostics';

describe('ModelProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no models when signed out in silent mode', async () => {
    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      isSignedIn: vi.fn().mockResolvedValue(false)
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);
    expect(models).toEqual([]);
  });

  it('caches discovered models within the ttl window', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova', context_window: 8192 }]
    });

    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      isSignedIn: vi.fn().mockResolvedValue(true),
      createClient: vi.fn().mockResolvedValue({
        models: { list },
        chat: { completions: { stream: async function* () { yield { type: 'done' } as const; } } }
      }),
      getSnapshot: vi.fn().mockResolvedValue({
        hasApiKey: true,
        connectionHealth: 'connected',
        toolCallingSupport: 'supported'
      })
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);
    await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reserves the default output budget from the context window when no output limit is advertised', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 8192
    });

    expect(model.maxInputTokens).toBe(4096);
    expect(model.maxOutputTokens).toBe(4096);
  });

  it('uses vLLM max_model_len as the context window when no gateway context window is advertised', () => {
    const model = providerInternals.toModelInfo({
      id: 'Qwen/Qwen3-14B',
      object: 'model',
      name: 'Qwen3 14B',
      created: 1,
      owned_by: 'vllm',
      max_model_len: 32768
    });

    expect(model.maxInputTokens).toBe(16384);
    expect(model.maxOutputTokens).toBe(16384);
  });

  it('uses explicit output limits when splitting the context window', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 128000,
      max_output_tokens: 16384
    });

    expect(model.maxInputTokens).toBe(111616);
    expect(model.maxOutputTokens).toBe(16384);
  });

  it('clamps output tokens to keep at least one input token in small context windows', () => {
    const model = providerInternals.toModelInfo({
      id: 'tiny-context',
      object: 'model',
      name: 'Tiny Context',
      created: 1,
      owned_by: 'nova',
      context_window: 1024,
      max_output_tokens: 4096
    });

    expect(model.maxInputTokens).toBe(1);
    expect(model.maxOutputTokens).toBe(1023);
  });

  it('uses an explicit input limit before deriving one from the context window', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 128000,
      max_input_tokens: 64000,
      max_output_tokens: 16384
    });

    expect(model.maxInputTokens).toBe(64000);
    expect(model.maxOutputTokens).toBe(16384);
  });

  it('adds the model output budget to chat completion requests by default', async () => {
    const progress = { report: vi.fn() };
    const stream = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: { content: 'ok' } }] } } as const;
    });
    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 128000,
      max_output_tokens: 32768
    });

    await provider.provideLanguageModelChatResponse(
      model,
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Tell me a long story')], name: undefined }],
      { toolMode: vscode.LanguageModelChatToolMode.Auto },
      progress,
      vscode.CancellationToken.None
    );

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 32768 }),
      expect.anything()
    );
  });

  it('preserves caller-provided output limits in model options', async () => {
    expect(providerInternals.createModelOptionsPayload(
      providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova', max_output_tokens: 32768 }),
      { max_tokens: 2048, temperature: 0.2 }
    )).toMatchObject({
      max_tokens: 2048,
      temperature: 0.2
    });
  });

  it('includes normalized metadata in detail and tooltip text', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      description: 'General purpose model',
      variant: 'pro',
      tags: ['chat'],
      capabilities: ['tools'],
      context_window: 128000,
      max_output_tokens: 16384
    });

    expect(model.detail).toBe('nova | pro | chat | tools');
    expect(model.tooltip).toContain('General purpose model');
    expect(model.tooltip).toContain('Input: 111,616 tokens');
    expect(model.tooltip).toContain('Output: 16,384 tokens');
  });

  it('parses model capabilities into VS Code native capability flags', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-vision',
      object: 'model',
      name: 'Nova Vision',
      created: 1,
      owned_by: 'nova',
      capabilities: ['tool_calling', 'vision'],
      context_window: 8192
    });

    expect(model.capabilities).toEqual({
      toolCalling: true,
      imageInput: true
    });
  });

  it('disables native capabilities when advertised capabilities do not include them', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-text',
      object: 'model',
      name: 'Nova Text',
      created: 1,
      owned_by: 'nova',
      capabilities: ['text'],
      context_window: 8192
    });

    expect(model.capabilities).toEqual({
      toolCalling: false,
      imageInput: false
    });
  });

  it('does not enable native capabilities when no capabilities are advertised', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-unknown',
      object: 'model',
      name: 'Nova Unknown',
      created: 1,
      owned_by: 'nova',
      context_window: 8192
    });

    expect(model.capabilities).toEqual({
      toolCalling: false,
      imageInput: false
    });
  });

  it('keeps default capabilities when capability parsing is disabled', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: <T>(key: string, defaultValue: T) =>
        (key === 'developer.parseModelCapabilities' ? false : defaultValue) as T
    } as ReturnType<typeof vscode.workspace.getConfiguration>);

    const model = providerInternals.toModelInfo({
      id: 'nova-vision',
      object: 'model',
      name: 'Nova Vision',
      created: 1,
      owned_by: 'nova',
      capabilities: ['vision'],
      context_window: 8192
    });

    expect(model.capabilities).toEqual({
      toolCalling: false,
      imageInput: false
    });
  });

  it('streams text and tool calls from Nova responses', async () => {
    const progress = { report: vi.fn() };
    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      createClient: vi.fn().mockResolvedValue({
        chat: {
          completions: {
            stream: async function* () {
              yield {
                type: 'chunk',
                data: {
                  choices: [
                    { delta: { content: 'Hello ' } },
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'call-1',
                            function: { name: 'searchWorkspace', arguments: '{"query":"nova"}' }
                          }
                        ]
                      },
                      finish_reason: 'tool_calls'
                    }
                  ]
                }
              } as const;
            }
          }
        }
      }),
      setSelectedModel: vi.fn(),
      setToolCallingSupport: vi.fn()
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());

    await provider.provideLanguageModelChatResponse(
      providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova' }),
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
      { toolMode: vscode.LanguageModelChatToolMode.Auto },
      progress,
      vscode.CancellationToken.None
    );

    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: 'Hello ' }));
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ name: 'searchWorkspace' }));
  });

  it('falls back to chat-only when Nova rejects tools in auto mode', async () => {
    const progress = { report: vi.fn() };
    const stream = vi.fn()
      .mockImplementationOnce(async function* () {
        const { NovaAIError } = await import('@datalabrotterdam/nova-sdk');
        throw new NovaAIError('tool payload rejected', {
          status: 400,
          body: {},
          response: new Response(),
          requestId: null,
          configId: null,
          type: null,
          code: 'invalid_request'
        });
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'chunk', data: { choices: [{ delta: { content: 'fallback' } }] } } as const;
      });

    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn(),
      setToolCallingSupport: vi.fn()
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());

    await provider.provideLanguageModelChatResponse(
      providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova' }),
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
      {
        tools: [{ name: 'searchWorkspace', description: 'Searches files', inputSchema: { type: 'object' } }],
        toolMode: vscode.LanguageModelChatToolMode.Auto
      },
      progress,
      vscode.CancellationToken.None
    );

    expect(stream).toHaveBeenCalledTimes(2);
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: 'fallback' }));
  });
});
