import { describe, expect, it } from 'vitest';
import type { ChatCompletionChunk } from '@datalabrotterdam/nova-sdk';
import { ChatStreamParser } from '../src/model/streamParser';
import { ToolNameMap } from '../src/model/toolSchema';
import { parseToolArguments } from '../src/model/jsonRepair';

function run(chunks: Array<Record<string, unknown> & { finish_reason?: string }>, toolNames: string[] = []) {
  const output = { text: '', thinking: '', toolCalls: [] as Array<{ id: string; name: string; input: unknown }> };
  const parser = new ChatStreamParser(
    { callIdPrefix: 'nova-test', toolNames: new ToolNameMap(toolNames) },
    {
      text: (value) => { output.text += value; },
      thinking: (value) => { output.thinking += value; },
      toolCall: (id, name, input) => { output.toolCalls.push({ id, name, input }); }
    }
  );

  for (const { finish_reason, ...delta } of chunks) {
    parser.pushChunk({ object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] } as ChatCompletionChunk);
  }
  parser.end();
  return { ...output, parser };
}

const toolDelta = (call: Record<string, unknown>) => ({ tool_calls: [call] });

describe('ChatStreamParser', () => {
  it('accumulates streamed tool-call arguments', () => {
    const { toolCalls } = run([
      toolDelta({ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"pa' } }),
      toolDelta({ index: 0, function: { arguments: 'th":"a.ts"}' } }),
      { finish_reason: 'tool_calls' }
    ], ['read_file']);

    expect(toolCalls).toEqual([{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }]);
  });

  it('generates unique ids when the server omits them', () => {
    const { toolCalls } = run([
      toolDelta({ index: 0, function: { name: 'a', arguments: '{}' } }),
      toolDelta({ index: 1, function: { name: 'b', arguments: '{}' } })
    ], ['a', 'b']);

    expect(toolCalls.map((call) => call.id)).toEqual(['nova-test-0', 'nova-test-1']);
  });

  it('replaces instead of appending when the server resends full arguments', () => {
    const { toolCalls } = run([
      toolDelta({ index: 0, id: 'c', function: { name: 'a', arguments: '{"x":1}' } }),
      toolDelta({ index: 0, function: { arguments: '{"x":1}' } })
    ], ['a']);

    expect(toolCalls[0].input).toEqual({ x: 1 });
  });

  it('handles servers that send each call whole without an index', () => {
    const { toolCalls } = run([
      toolDelta({ id: 'c1', function: { name: 'a', arguments: '{"n":1}' } }),
      toolDelta({ id: 'c2', function: { name: 'b', arguments: { n: 2 } } })
    ], ['a', 'b']);

    expect(toolCalls).toEqual([
      { id: 'c1', name: 'a', input: { n: 1 } },
      { id: 'c2', name: 'b', input: { n: 2 } }
    ]);
  });

  it('treats empty arguments as an empty object', () => {
    expect(run([toolDelta({ index: 0, id: 'c', function: { name: 'a', arguments: '' } })], ['a']).toolCalls[0].input).toEqual({});
  });

  it('skips calls with unrepairable arguments and explains why', () => {
    const { toolCalls, text, parser } = run([
      toolDelta({ index: 0, id: 'c', function: { name: 'a', arguments: 'not json at all' } })
    ], ['a']);

    expect(toolCalls).toEqual([]);
    expect(text).toContain('invalid arguments');
    expect(parser.invalidToolCalls).toEqual(['a']);
  });

  it('maps sanitized tool names back to VS Code names', () => {
    const { toolCalls } = run([toolDelta({ index: 0, id: 'c', function: { name: 'my_tool', arguments: '{}' } })], ['my.tool']);
    expect(toolCalls[0].name).toBe('my.tool');
  });

  it('routes reasoning and <think> blocks to thinking, also across chunk boundaries', () => {
    const { text, thinking } = run([
      { reasoning_content: 'plan. ' },
      { content: 'Hi <thi' },
      { content: 'nk>secret</th' },
      { content: 'ink>there' }
    ]);

    expect(text).toBe('Hi there');
    expect(thinking).toBe('plan. secret');
  });

  it('routes Gemma 4 channel reasoning to thinking and drops its label', () => {
    const { text, thinking } = run([
      { content: '<|chan' },
      { content: 'nel>thought\nThe user asks what I see.' },
      { content: ' I should describe the image.<chan' },
      { content: 'nel|>I see a cat.<turn|>' }
    ]);

    expect(text).toBe('I see a cat.');
    expect(thinking).toBe('The user asks what I see. I should describe the image.');
  });

  it('routes gpt-oss analysis channels to thinking and strips harmony markers', () => {
    const { text, thinking } = run([
      { content: '<|channel|>analysis<|message|>Need to answer briefly.<|end|>' },
      { content: '<|start|>assistant<|channel|>final<|message|>Hello!<|return|>' }
    ]);

    expect(thinking).toBe('Need to answer briefly.');
    expect(text).toBe('Hello!');
  });

  it('removes end-of-turn tokens split across chunks', () => {
    expect(run([{ content: 'Done.<|im_' }, { content: 'end|>' }]).text).toBe('Done.');
  });

  it('converts <tool_call> text into real tool calls for offered tools', () => {
    const { text, toolCalls } = run([
      { content: 'Let me look.<tool_' },
      { content: 'call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>' }
    ], ['read_file']);

    expect(text).toBe('Let me look.');
    expect(toolCalls).toEqual([{ id: 'nova-test-0', name: 'read_file', input: { path: 'a.ts' } }]);
  });

  it('converts Gemma 4 <|tool_call>call:name{…}<tool_call|> text, split across chunks', () => {
    const { text, toolCalls } = run([
      { content: '<|tool_call>call:run_command{command:<|"|>ls -F /Users/me/.claude/' },
      { content: 'skills/synced/<|"|>}<tool_call|>' }
    ], ['run_command']);

    expect(text).toBe('');
    expect(toolCalls).toEqual([{ id: 'nova-test-0', name: 'run_command', input: { command: 'ls -F /Users/me/.claude/skills/synced/' } }]);
  });

  it('keeps quotes, colons and nested values in Gemma 4 tool calls', () => {
    const { toolCalls } = run([
      { content: '<|tool_call>call:edit_file{path:<|"|>a.ts<|"|>,old_string:<|"|>say("hi"): x<|"|>,line:3,flags:{dry:true},list:[1,2]}<tool_call|>' }
    ], ['edit_file']);

    expect(toolCalls[0].input).toEqual({ path: 'a.ts', old_string: 'say("hi"): x', line: 3, flags: { dry: true }, list: [1, 2] });
  });

  it('converts Mistral [TOOL_CALLS] arrays', () => {
    const { toolCalls } = run([
      { content: '[TOOL_CALLS][{"name":"a","arguments":"{\\"x\\":1}"},{"name":"b","arguments":{}}]' }
    ], ['a', 'b']);

    expect(toolCalls.map((call) => [call.name, call.input])).toEqual([['a', { x: 1 }], ['b', {}]]);
  });

  it('leaves text tool calls for unknown tools as text', () => {
    const block = '<tool_call>{"name":"unknown","arguments":{}}</tool_call>';
    const { text, toolCalls } = run([{ content: block }], ['read_file']);

    expect(toolCalls).toEqual([]);
    expect(text).toBe(block);
  });

  it('does not look for text tool calls when no tools were offered', () => {
    const block = '<tool_call>{"name":"read_file","arguments":{}}</tool_call>';
    expect(run([{ content: block }]).text).toBe(block);
  });

  it('reports whether text or tool calls were received', () => {
    const { parser } = run([{ reasoning_content: 'only thinking' }]);
    expect(parser.receivedText).toBe(false);
    expect(parser.receivedToolCalls).toBe(false);
  });
});

describe('parseToolArguments', () => {
  it.each([
    ['{"a":1,}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['{"a":{"b":"c"', { a: { b: 'c' } }],
    ['"{\\"a\\":1}"', { a: 1 }]
  ])('repairs %s', (input, expected) => {
    expect(parseToolArguments(input)).toEqual(expected);
  });

  it('rejects non-object arguments', () => {
    expect(parseToolArguments('[1,2]')).toBeUndefined();
    expect(parseToolArguments('hello')).toBeUndefined();
  });
});
