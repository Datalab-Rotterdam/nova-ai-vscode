import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { runAgentLoop, type AgentLoopRequest } from '../src/agent/AgentLoop';
import { NOVA_USAGE_MIME_TYPE } from '../src/core/constants';

type Part = vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelDataPart;

let modelCount = 0;

/** Each fake model gets its own id, so token calibration does not leak between tests. */
function fakeModel(responses: Array<Part[] | Error>, maxInputTokens = 100_000) {
  const sendRequest = vi.fn();
  for (const response of responses) {
    sendRequest.mockImplementationOnce(async () => {
      if (response instanceof Error) {
        throw response;
      }
      return { stream: (async function* () { yield* response; })(), text: (async function* () {})() };
    });
  }
  return { id: `nova-test-${modelCount++}`, vendor: 'nova-ai', maxInputTokens, sendRequest } as unknown as vscode.LanguageModelChat & { sendRequest: typeof sendRequest };
}

const tool = { name: 'read_file', description: 'Reads a file', inputSchema: { type: 'object' }, tags: [] } as vscode.LanguageModelToolInformation;

function request(model: vscode.LanguageModelChat, overrides: Partial<AgentLoopRequest> = {}): AgentLoopRequest {
  return {
    model,
    messages: [vscode.LanguageModelChatMessage.User('system'), vscode.LanguageModelChatMessage.User('Read a.ts')],
    pinned: 1,
    tools: [tool],
    invokeTool: vi.fn().mockResolvedValue({ content: [new vscode.LanguageModelTextPart('file contents')] }),
    maxRounds: 10,
    autoCompact: true,
    compactThreshold: 0.8,
    ...overrides
  };
}

describe('runAgentLoop', () => {
  it('invokes requested tools, feeds results back and records the rounds', async () => {
    const model = fakeModel([
      [new vscode.LanguageModelTextPart('Reading. '), new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.ts' })],
      [new vscode.LanguageModelTextPart('Done.'), vscode.LanguageModelDataPart.json({ promptTokens: 120, completionTokens: 8 }, NOVA_USAGE_MIME_TYPE)]
    ]);
    const req = request(model);
    const text: string[] = [];

    const result = await runAgentLoop(req, { text: (value) => text.push(value) }, vscode.CancellationToken.None);

    expect(text.join('')).toBe('Reading. Done.');
    expect(req.invokeTool).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1' }), expect.anything());
    expect(req.messages.map((message) => message.role)).toEqual([1, 1, 2, 1, 2]);
    expect(req.messages[2].content).toHaveLength(2);
    expect(result.rounds).toEqual([{ response: 'Reading. ', calls: [{ callId: 'call-1', name: 'read_file', input: { path: 'a.ts' }, result: 'file contents' }] }]);
    expect(result.finalText).toBe('Done.');
    expect(result.promptTokens).toBe(120);
  });

  it('requires an explicitly referenced tool in the first round only', async () => {
    const model = fakeModel([
      [new vscode.LanguageModelToolCallPart('call-1', 'read_file', {})],
      [new vscode.LanguageModelTextPart('ok')]
    ]);
    const other = { ...tool, name: 'search' };

    await runAgentLoop(request(model, { tools: [tool, other], forcedTool: 'read_file' }), { text: () => undefined }, vscode.CancellationToken.None);

    expect(model.sendRequest.mock.calls[0][1]).toEqual({ tools: [tool], toolMode: vscode.LanguageModelChatToolMode.Required });
    expect(model.sendRequest.mock.calls[1][1]).toEqual({ tools: [tool, other], toolMode: vscode.LanguageModelChatToolMode.Auto });
  });

  it('reports tool errors to the model instead of failing', async () => {
    const model = fakeModel([
      [new vscode.LanguageModelToolCallPart('call-1', 'read_file', {})],
      [new vscode.LanguageModelTextPart('recovered')]
    ]);
    const req = request(model, { invokeTool: vi.fn().mockRejectedValue(new Error('file not found')) });

    await runAgentLoop(req, { text: () => undefined }, vscode.CancellationToken.None);

    const toolResult = req.messages[3].content[0] as vscode.LanguageModelToolResultPart;
    expect((toolResult.content[0] as vscode.LanguageModelTextPart).value).toBe('Error: file not found');
  });

  it('stops at the round limit', async () => {
    const model = fakeModel([
      [new vscode.LanguageModelToolCallPart('call-1', 'read_file', {})],
      [new vscode.LanguageModelToolCallPart('call-2', 'read_file', {})]
    ]);

    const result = await runAgentLoop(request(model, { maxRounds: 2 }), { text: () => undefined }, vscode.CancellationToken.None);

    expect(result.hitRoundLimit).toBe(true);
    expect(model.sendRequest).toHaveBeenCalledTimes(2);
  });

  it('compacts and retries once when the request overflows the context window', async () => {
    const model = fakeModel([
      new Error('This model\'s maximum context length is 8192 tokens.'),
      [new vscode.LanguageModelTextPart('summary of earlier work')],
      [new vscode.LanguageModelTextPart('answer')]
    ], 8_000);
    const messages = [vscode.LanguageModelChatMessage.User('system')];
    for (let index = 0; index < 6; index++) {
      messages.push(vscode.LanguageModelChatMessage.User(`question ${index} ${'x'.repeat(2_000)}`));
      messages.push(vscode.LanguageModelChatMessage.Assistant(`answer ${index}`));
    }
    messages.push(vscode.LanguageModelChatMessage.User('final question'));
    const compacted = vi.fn();

    const result = await runAgentLoop(request(model, { messages, tools: [] }), { text: () => undefined, compacted }, vscode.CancellationToken.None);

    expect(compacted).toHaveBeenCalledWith('summarized');
    expect(result.summary).toBe('summary of earlier work');
    expect(result.finalText).toBe('answer');
    expect(model.sendRequest).toHaveBeenCalledTimes(3);
  });

  it('rethrows errors that are not context overflows', async () => {
    const model = fakeModel([new Error('rate limited')]);
    await expect(runAgentLoop(request(model), { text: () => undefined }, vscode.CancellationToken.None)).rejects.toThrow('rate limited');
  });
});
