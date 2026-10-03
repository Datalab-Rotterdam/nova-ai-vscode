import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { buildHistory } from '../src/chat/AgentParticipant';

const roles = (messages: vscode.LanguageModelChatMessage[]) => messages.map((message) => message.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant');

describe('@nova history', () => {
  it('replays tool calls and results stored in result metadata', () => {
    const history = [
      new vscode.ChatRequestTurn('Read a.ts'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('Reading. Done.')], {
        metadata: {
          rounds: [{ response: 'Reading. ', calls: [{ callId: 'c1', name: 'read_file', input: { path: 'a.ts' }, result: 'contents' }] }],
          finalText: 'Done.'
        }
      })
    ];

    const messages = buildHistory(history as never);

    expect(roles(messages)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[1].content[1]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    expect(messages[2].content[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart);
    expect((messages[3].content[0] as vscode.LanguageModelTextPart).value).toBe('Done.');
  });

  it('falls back to markdown for turns without metadata', () => {
    const messages = buildHistory([
      new vscode.ChatRequestTurn('Hi'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('Hello!')], {})
    ] as never);

    expect((messages[1].content[0] as vscode.LanguageModelTextPart).value).toBe('Hello!');
  });

  it('continues from a /compact summary instead of older turns', () => {
    const messages = buildHistory([
      new vscode.ChatRequestTurn('old question'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('old answer')], {}),
      new vscode.ChatRequestTurn('', 'compact'),
      new vscode.ChatResponseTurn([], { metadata: { summary: 'We discussed X.' } }),
      new vscode.ChatRequestTurn('next')
    ] as never);

    expect(messages).toHaveLength(2);
    expect((messages[0].content[0] as vscode.LanguageModelTextPart).value).toContain('We discussed X.');
    expect((messages[1].content[0] as vscode.LanguageModelTextPart).value).toBe('next');
  });

  it('keeps the prompt of a turn that was auto-compacted', () => {
    const messages = buildHistory([
      new vscode.ChatRequestTurn('old'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('old answer')], {}),
      new vscode.ChatRequestTurn('big task'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('done')], { metadata: { summary: 'S', rounds: [], finalText: 'done' } })
    ] as never);

    expect(messages.map((message) => (message.content[0] as vscode.LanguageModelTextPart).value)).toEqual([
      expect.stringContaining('S'),
      'big task',
      'done'
    ]);
  });
});
