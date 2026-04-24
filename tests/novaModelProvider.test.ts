import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { NovaModelProvider, providerInternals } from '../src/novaModelProvider';
import { NovaDiagnostics } from '../src/novaDiagnostics';

describe('NovaModelProvider', () => {
  it('returns no models when signed out in silent mode', async () => {
    const sessionService = {
      onDidChangeSession: () => ({ dispose: () => undefined }),
      isSignedIn: vi.fn().mockResolvedValue(false)
    };

    const provider = new NovaModelProvider(sessionService as never, new NovaDiagnostics());
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

    const provider = new NovaModelProvider(sessionService as never, new NovaDiagnostics());
    await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);
    await provider.provideLanguageModelChatInformation({ silent: true }, vscode.CancellationToken.None);

    expect(list).toHaveBeenCalledTimes(1);
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

    const provider = new NovaModelProvider(sessionService as never, new NovaDiagnostics());

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

    const provider = new NovaModelProvider(sessionService as never, new NovaDiagnostics());

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

