import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { lineStats, replaceSnippet } from '../src/agent/tools/editTools';
import { runShell } from '../src/agent/tools/terminalTool';
import { ToolInputError } from '../src/agent/tools/types';
import { resolveWorkspacePath } from '../src/agent/tools/workspacePaths';
import { closeDanglingToolCalls } from '../src/panel/ChatController';
import { fromStoredMessages, toStoredMessages } from '../src/panel/SessionStore';

type MutableWorkspace = { workspaceFolders?: Array<{ name: string; uri: vscode.Uri; index: number }> };

describe('edit_file snippet replacement', () => {
  it('replaces a unique snippet', () => {
    expect(replaceSnippet('a\nb\nc\n', 'b', 'B', false)).toBe('a\nB\nc\n');
  });

  it('rejects missing and ambiguous snippets with guidance for the model', () => {
    expect(() => replaceSnippet('a\nb', 'x', 'y', false)).toThrow(/not found/);
    expect(() => replaceSnippet('x x', 'x', 'y', false)).toThrow(/occurs 2 times/);
    expect(() => replaceSnippet('x x', 'x', 'y', false)).toThrow(ToolInputError);
  });

  it('replaces all occurrences when asked', () => {
    expect(replaceSnippet('x x', 'x', 'y', true)).toBe('y y');
  });

  it('matches LF snippets in CRLF files and keeps CRLF', () => {
    expect(replaceSnippet('one\r\ntwo\r\nthree', 'one\ntwo', 'uno\ndos', false)).toBe('uno\r\ndos\r\nthree');
  });

  it('does not interpret $ patterns in the replacement', () => {
    expect(replaceSnippet('price', 'price', '$& $1', false)).toBe('$& $1');
  });

  it('counts changed lines', () => {
    expect(lineStats('a\nb\nc', 'a\nB\nB2\nc')).toEqual({ added: 2, removed: 1 });
    expect(lineStats('', 'new\nfile')).toEqual({ added: 2, removed: 0 });
  });
});

describe('workspace paths', () => {
  beforeEach(() => {
    (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = [
      { name: 'app', uri: vscode.Uri.file('/repo/app'), index: 0 }
    ];
  });

  afterEach(() => {
    (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = undefined;
  });

  it('resolves relative and absolute paths inside the workspace', () => {
    expect(resolveWorkspacePath('src/a.ts').fsPath).toBe('/repo/app/src/a.ts');
    expect(resolveWorkspacePath('/repo/app/b.ts').fsPath).toBe('/repo/app/b.ts');
  });

  it('rejects paths outside the workspace', () => {
    expect(() => resolveWorkspacePath('../secrets.txt')).toThrow(/outside the workspace/);
    expect(() => resolveWorkspacePath('/etc/passwd')).toThrow(/outside the workspace/);
    expect(() => resolveWorkspacePath('/repo/app-other/x')).toThrow(/outside the workspace/);
    expect(() => resolveWorkspacePath('')).toThrow(/required/);
  });
});

describe('run_command shell runner', () => {
  it('captures output and exit code', async () => {
    const result = await runShell('echo hello && exit 3', process.cwd(), 10_000, vscode.CancellationToken.None as vscode.CancellationToken);
    expect(result.output).toBe('hello');
    expect(result.exitCode).toBe(3);
  });

  it('stops commands that exceed the timeout, including the processes they started', async () => {
    const started = Date.now();
    // A compound command keeps sh as the parent on every platform, like dash on Linux CI.
    // Even if the shell survives SIGTERM and starts the next sleep, SIGKILL ends the group.
    const result = await runShell('sleep 5; sleep 5', process.cwd(), 200, vscode.CancellationToken.None as vscode.CancellationToken);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('stops a command when the run is cancelled', async () => {
    const source = new vscode.CancellationTokenSource();
    setTimeout(() => source.cancel(), 100);
    const result = await runShell('sleep 5', process.cwd(), 10_000, source.token as unknown as vscode.CancellationToken);
    expect(result.cancelled).toBe(true);
  });
});

describe('panel conversation', () => {
  it('round-trips messages through storage', () => {
    const messages = [
      vscode.LanguageModelChatMessage.User('hi'),
      vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart('c1', 'read_file', { path: 'a' })]),
      vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart('text')])])
    ] as vscode.LanguageModelChatMessage[];

    const stored = toStoredMessages(messages);
    expect(stored).toEqual([
      { role: 'user', parts: [{ type: 'text', value: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'toolCall', callId: 'c1', name: 'read_file', input: { path: 'a' } }] },
      { role: 'user', parts: [{ type: 'toolResult', callId: 'c1', text: 'text' }] }
    ]);
    expect(toStoredMessages(fromStoredMessages(stored))).toEqual(stored);
  });

  it('adds placeholder results when a run stopped after a tool call', () => {
    const messages = [
      vscode.LanguageModelChatMessage.User('go'),
      vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart('c1', 'run_command', {})])
    ] as vscode.LanguageModelChatMessage[];

    const closed = closeDanglingToolCalls(messages);
    expect(closed).toHaveLength(3);
    expect((closed[2].content[0] as vscode.LanguageModelToolResultPart).callId).toBe('c1');
    expect(closeDanglingToolCalls(closed)).toBe(closed);
  });
});

describe('editing an earlier message', () => {
  it('rebuilds the conversation from the chat when the recorded position no longer matches', async () => {
    const { truncateConversation } = await import('../src/panel/ChatController');
    const summary = vscode.LanguageModelChatMessage.User('<conversation-summary>…</conversation-summary>');
    const kept = [
      { kind: 'user' as const, id: 'u1', text: 'question', attachments: [] },
      { kind: 'assistant' as const, id: 'a1', text: 'answer' }
    ];
    const edited = { kind: 'user' as const, id: 'u2', text: 'follow-up', attachments: [], messageIndex: 5 };

    const rebuilt = truncateConversation([summary], edited, kept);
    expect(rebuilt.map((message) => (message.content[0] as vscode.LanguageModelTextPart).value)).toEqual(['question', 'answer']);

    const exact = [vscode.LanguageModelChatMessage.User('question'), vscode.LanguageModelChatMessage.Assistant('answer'), vscode.LanguageModelChatMessage.User('follow-up')];
    expect(truncateConversation(exact as never, { ...edited, messageIndex: 2 }, kept)).toHaveLength(2);
  });
});
