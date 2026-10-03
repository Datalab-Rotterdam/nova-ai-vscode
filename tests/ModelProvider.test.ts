import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ModelProvider, pricingLabel, providerInternals } from '../src/model/modelProvider';
import { Diagnostics } from '../src/core/diagnostics';

describe('ModelProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no models when signed out in silent mode', async () => {
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
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
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
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

  it('reserves a quarter of the context window for output when no output limit is advertised', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 8192
    });

    expect(model.maxInputTokens).toBe(5120);
    expect(model.maxOutputTokens).toBe(2048);
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

    expect(model.maxInputTokens).toBe(23552);
    expect(model.maxOutputTokens).toBe(8192);
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

    expect(model.maxInputTokens).toBe(109056);
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

  it('reserves proportional headroom for chat-template and token-estimation overhead', () => {
    const model = providerInternals.toModelInfo({
      id: 'qwen3.8:27b',
      object: 'model',
      name: 'Qwen 3.8 27B',
      created: 1,
      owned_by: 'nova',
      context_window: 262144,
      max_output_tokens: 16384
    });

    expect(model.maxInputTokens).toBe(240517);
    expect(model.maxOutputTokens).toBe(16384);
  });

  it('adds the model output budget to chat completion requests by default', async () => {
    const progress = { report: vi.fn() };
    const stream = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: { content: 'ok' } }] } } as const;
    });
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
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
    expect(model.tooltip).toContain('Input: 109,056 tokens');
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

    expect(model.capabilities).toMatchObject({
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

    expect(model.capabilities).toMatchObject({
      toolCalling: false,
      imageInput: false
    });
  });

  it('leaves tool calling undetermined when no capabilities are advertised', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-unknown',
      object: 'model',
      name: 'Nova Unknown',
      created: 1,
      owned_by: 'nova',
      context_window: 8192
    });

    expect(model.capabilities).toMatchObject({
      toolCalling: undefined,
      imageInput: false
    });
  });

  it('ignores advertised capabilities when capability parsing is disabled', () => {
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

    expect(model.capabilities).toMatchObject({
      toolCalling: undefined,
      imageInput: false
    });
  });

  it('offers undetermined models as tool-capable until tools are rejected', async () => {
    const support = new Map<string, string>([['nova-legacy', 'unsupported']]);
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      isSignedIn: vi.fn().mockResolvedValue(true),
      getModelToolSupport: (id: string) => support.get(id) ?? 'unknown',
      createClient: vi.fn().mockResolvedValue({
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'nova-new', name: 'Nova New', created: 1, owned_by: 'nova' },
              { id: 'nova-legacy', name: 'Nova Legacy', created: 1, owned_by: 'nova' }
            ]
          })
        }
      })
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);

    expect(models.find((model) => model.id === 'nova-new')?.capabilities.toolCalling).toBe(128);
    expect(models.find((model) => model.id === 'nova-legacy')?.capabilities.toolCalling).toBe(false);
    expect(models.find((model) => model.id === 'nova-new')?.isDefault).toBe(true);
  });

  it('streams text and tool calls from Nova responses', async () => {
    const progress = { report: vi.fn() };
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
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
      setSelectedModel: vi.fn()
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
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
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

  it('retries an empty tool response once, then answers without tools and keeps tools enabled', async () => {
    const progress = { report: vi.fn() };
    const empty = async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: {}, finish_reason: 'stop' }] } } as const;
    };
    const stream = vi.fn()
      .mockImplementationOnce(empty)
      .mockImplementationOnce(empty)
      .mockImplementationOnce(async function* () {
        yield { type: 'chunk', data: { choices: [{ delta: { content: 'plain answer' } }] } } as const;
      });
    const setModelToolSupport = vi.fn();
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport,
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
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

    expect(stream).toHaveBeenCalledTimes(3);
    expect(stream.mock.calls[1][0]).toHaveProperty('tools');
    expect(stream.mock.calls[2][0]).not.toHaveProperty('tools');
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: 'plain answer' }));
    expect(setModelToolSupport).not.toHaveBeenCalledWith('nova-pro', 'unsupported');
  });

  it('does not send tools to models where Nova rejected them before', async () => {
    const stream = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: { content: 'ok' } }] } } as const;
    });
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unsupported'),
      setModelToolSupport: vi.fn(),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
    };

    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    await provider.provideLanguageModelChatResponse(
      providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova' }),
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
      {
        tools: [{ name: 'searchWorkspace', description: 'Searches files', inputSchema: { type: 'object' } }],
        toolMode: vscode.LanguageModelChatToolMode.Auto
      },
      { report: vi.fn() },
      vscode.CancellationToken.None
    );

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).not.toHaveProperty('tools');
  });

  it('advertises edit tools, context window, pricing and per-model configuration when proposals are enabled', () => {
    const state = (vscode as unknown as { testState: { enabledApiProposals: string[] } }).testState;
    state.enabledApiProposals = ['chatProvider', 'languageModelPricing'];
    try {
      const model = providerInternals.toModelInfo({
        id: 'nova-pro',
        object: 'model',
        name: 'Nova Pro',
        created: 1,
        owned_by: 'nova',
        context_window: 8192,
        input_cost_per_1m: 0.2,
        output_cost_per_1m: 0.6,
        currency: 'EUR'
      });

      expect(model.capabilities.editTools).toEqual(['find-replace', 'multi-find-replace']);
      expect(model.maxContextWindowTokens).toBe(8192);
      expect(model.pricing).toBe('€0.20 in / €0.60 out per 1M tokens');
      expect(Object.keys(model.configurationSchema?.properties ?? {})).toEqual(['temperature', 'reasoningEffort', 'maxOutputTokens']);
    } finally {
      state.enabledApiProposals = [];
    }
  });

  it('omits proposal-only model fields in stable VS Code, where they would break the model list', () => {
    const model = providerInternals.toModelInfo({
      id: 'nova-pro',
      object: 'model',
      name: 'Nova Pro',
      created: 1,
      owned_by: 'nova',
      context_window: 8192,
      input_cost_per_1m: 0.2,
      output_cost_per_1m: 0.6
    });

    expect(model.capabilities).not.toHaveProperty('editTools');
    expect(model).not.toHaveProperty('configurationSchema');
    expect(model).not.toHaveProperty('pricing');
    expect(pricingLabel(model)).toBe('€0.20 in / €0.60 out per 1M tokens');
  });

  it('maps per-model configuration to request options, with explicit model options winning', () => {
    const model = providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova', max_output_tokens: 4096 });

    expect(providerInternals.createModelOptionsPayload(
      model,
      { temperature: 0.1 },
      { temperature: 0.7, reasoningEffort: 'high', maxOutputTokens: 1024 }
    )).toEqual({ temperature: 0.1, reasoning_effort: 'high', max_tokens: 1024 });
  });

  it('rewrites the Copilot identity in requests from other extensions only', async () => {
    const stream = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: { content: 'ok' } }] } } as const;
    });
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
    };
    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    const model = providerInternals.toModelInfo({ id: 'nova-pro', name: 'Nova Pro', created: 1, owned_by: 'nova' });
    const messages = [
      { role: 3 as vscode.LanguageModelChatMessageRole, content: [new vscode.LanguageModelTextPart('You are GitHub Copilot.')], name: undefined },
      { role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }
    ];

    await provider.provideLanguageModelChatResponse(model, messages, { toolMode: vscode.LanguageModelChatToolMode.Auto, requestInitiator: 'github.copilot-chat' }, { report: vi.fn() }, vscode.CancellationToken.None);
    await provider.provideLanguageModelChatResponse(model, messages, { toolMode: vscode.LanguageModelChatToolMode.Auto, requestInitiator: 'datalabrotterdam.nova-ai-vscode' }, { report: vi.fn() }, vscode.CancellationToken.None);

    expect(stream.mock.calls[0][0].messages[0].content).toMatch(/^You are Nova/);
    expect(stream.mock.calls[1][0].messages[0].content).toBe('You are GitHub Copilot.');
  });

  it('passes reasoning to Nova\'s own panel only, and never as visible text', async () => {
    const stream = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', data: { choices: [{ delta: { content: '<|channel>thought\nlooking<channel|>A cat.' } }] } } as const;
    });
    const sessionService = {
      onDidChangeAccount: () => ({ dispose: () => undefined }),
      getModelToolSupport: vi.fn().mockReturnValue('unknown'),
      setModelToolSupport: vi.fn(),
      createClient: vi.fn().mockResolvedValue({ chat: { completions: { stream } } }),
      setSelectedModel: vi.fn()
    };
    const provider = new ModelProvider(sessionService as never, new Diagnostics());
    const model = providerInternals.toModelInfo({ id: 'gemma', name: 'Gemma', created: 1, owned_by: 'nova' });
    const messages = [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('What do you see?')], name: undefined }];
    const parts = (initiator: string) => {
      const reported: unknown[] = [];
      return provider.provideLanguageModelChatResponse(model, messages, { toolMode: vscode.LanguageModelChatToolMode.Auto, requestInitiator: initiator }, { report: (part) => reported.push(part) }, vscode.CancellationToken.None)
        .then(() => reported);
    };

    const panel = await parts('datalabrotterdam.nova-ai-vscode');
    const copilot = await parts('github.copilot-chat');

    const texts = (reported: unknown[]) => reported.filter((part) => part instanceof vscode.LanguageModelTextPart).map((part) => (part as vscode.LanguageModelTextPart).value).join('');
    expect(texts(panel)).toBe('A cat.');
    expect(texts(copilot)).toBe('A cat.');
    expect(panel.some((part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === 'application/vnd.nova-ai.thinking')).toBe(true);
    expect(copilot.some((part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === 'application/vnd.nova-ai.thinking')).toBe(false);
  });
});
