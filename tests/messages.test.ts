import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { NOVA_USAGE_MIME_TYPE } from '../src/core/constants';
import { toNovaMessages } from '../src/model/messages';
import { ToolNameMap } from '../src/model/toolSchema';

const SYSTEM = 3 as vscode.LanguageModelChatMessageRole;
const { User, Assistant } = vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, ...content: unknown[]): vscode.LanguageModelChatRequestMessage {
  return { role, content, name: undefined } as vscode.LanguageModelChatRequestMessage;
}

const text = (value: string) => new vscode.LanguageModelTextPart(value);
const data = (value: string, mimeType: string) => new vscode.LanguageModelDataPart(new TextEncoder().encode(value), mimeType);

describe('toNovaMessages', () => {
  it('drops cache_control and usage data parts instead of turning them into text', () => {
    const result = toNovaMessages([
      message(SYSTEM, text('You are helpful.'), data('ephemeral', 'cache_control')),
      message(User, text('Hi'), data('{"promptTokens":1}', NOVA_USAGE_MIME_TYPE), data('ephemeral', 'cache_control'))
    ]);

    expect(result).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' }
    ]);
  });

  it('keeps text data parts', () => {
    expect(toNovaMessages([message(User, data('{"a":1}', 'application/json'))])).toEqual([
      { role: 'user', content: '{"a":1}' }
    ]);
  });

  it('sends images as image_url parts only for vision models', () => {
    const image = new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), 'image/png');

    expect(toNovaMessages([message(User, text('What is this?'), image)], { supportsImages: true })).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
        ]
      }
    ]);
    expect(toNovaMessages([message(User, text('What is this?'), image)])).toEqual([
      { role: 'user', content: 'What is this?' }
    ]);
  });

  it('uses null content for assistant messages that only call tools', () => {
    const result = toNovaMessages([
      message(User, text('Read a.ts')),
      message(Assistant, new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.ts' })),
      message(User, new vscode.LanguageModelToolResultPart('call-1', [text('contents')]))
    ]);

    expect(result[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }]
    });
    expect(result[2]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'contents' });
  });

  it('skips empty messages', () => {
    expect(toNovaMessages([
      message(SYSTEM, text('')),
      message(User, text('  ')),
      message(Assistant, text('')),
      message(User, text('Hello'))
    ])).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('places tool results before user text from the same message', () => {
    const result = toNovaMessages([
      message(Assistant, new vscode.LanguageModelToolCallPart('call-1', 'run', {})),
      message(User, text('Also consider this.'), new vscode.LanguageModelToolResultPart('call-1', [text('done')]))
    ]);

    expect(result.map((entry) => entry.role)).toEqual(['assistant', 'tool', 'user']);
  });

  it('unwraps tool result parts instead of serializing them', () => {
    const tsxPart = { value: { node: { children: [{ text: 'line 1\n' }, { text: 'line 2' }] } } };
    const result = toNovaMessages([
      message(Assistant, new vscode.LanguageModelToolCallPart('call-1', 'read', {})),
      message(User, new vscode.LanguageModelToolResultPart('call-1', [text('plain'), tsxPart]))
    ]);

    expect(result[1].content).toBe('plain\nline 1\nline 2');
  });

  it('never sends an empty tool result', () => {
    const result = toNovaMessages([
      message(Assistant, new vscode.LanguageModelToolCallPart('call-1', 'run', {})),
      message(User, new vscode.LanguageModelToolResultPart('call-1', []))
    ]);

    expect(result[1].content).toBe('(no output)');
  });

  it('drops orphaned tool results and fills in missing ones', () => {
    const result = toNovaMessages([
      message(User, new vscode.LanguageModelToolResultPart('stale', [text('old')])),
      message(User, text('Go')),
      message(Assistant,
        new vscode.LanguageModelToolCallPart('call-1', 'a', {}),
        new vscode.LanguageModelToolCallPart('call-2', 'b', {})),
      message(User, new vscode.LanguageModelToolResultPart('call-2', [text('b done')]))
    ]);

    expect(result.map((entry) => [entry.role, entry.tool_call_id])).toEqual([
      ['user', undefined],
      ['assistant', undefined],
      ['tool', 'call-1'],
      ['tool', 'call-2']
    ]);
    expect(String(result[2].content)).toContain('no result');
  });

  it('merges consecutive messages with the same role', () => {
    expect(toNovaMessages([
      message(SYSTEM, text('A')),
      message(SYSTEM, text('B')),
      message(User, text('C')),
      message(User, text('D'))
    ])).toEqual([
      { role: 'system', content: 'A\n\nB' },
      { role: 'user', content: 'C\n\nD' }
    ]);
  });

  it('maps tool names to the names sent to Nova', () => {
    const names = new ToolNameMap(['my.tool']);
    const result = toNovaMessages([
      message(Assistant, new vscode.LanguageModelToolCallPart('call-1', 'my.tool', {})),
      message(User, new vscode.LanguageModelToolResultPart('call-1', [text('ok')]))
    ], { toolNames: names });

    expect((result[0].tool_calls as Array<{ function: { name: string } }>)[0].function.name).toBe('my_tool');
  });
});
