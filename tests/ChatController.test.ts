import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

let currentModel: unknown;
vi.mock('../src/panel/directModel', () => ({ createDirectModel: () => currentModel }));

import { Diagnostics } from '../src/core/diagnostics';
import { ChatController } from '../src/panel/ChatController';
import type { ChatEvent, ToolItem } from '../src/panel/protocol';

type Part = vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart;

function fakeModel(responses: Part[][]) {
  const sendRequest = vi.fn();
  for (const response of responses) {
    sendRequest.mockImplementationOnce(async () => ({ stream: (async function* () { yield* response; })() }));
  }
  return { id: `nova-panel-${Math.random()}`, name: 'Nova Test', vendor: 'nova-ai', maxInputTokens: 100_000, sendRequest };
}

function setup(responses: Part[][], approvalMode = 'autoReadOnly', services: Record<string, unknown> = {}) {
  const model = fakeModel(responses);
  currentModel = model;
  const modelProvider = {
    onDidChangeLanguageModelChatInformation: () => ({ dispose: () => undefined }),
    listModels: async () => [{ id: model.id, name: model.name, maxInputTokens: model.maxInputTokens, isDefault: true }]
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: <T>(key: string, fallback: T) => (key === 'agent.approvalMode' ? approvalMode : fallback) as T,
    update: vi.fn()
  } as unknown as vscode.WorkspaceConfiguration);
  (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
    { name: 'repo', uri: vscode.Uri.file(process.cwd()), index: 0 }
  ];

  const events: ChatEvent[] = [];
  const store = { list: vi.fn(() => [] as Array<{ id: string; title: string; updatedAt: number }>), load: vi.fn(), save: vi.fn(), delete: vi.fn(), rename: vi.fn() };
  const memento = { get: () => undefined, update: vi.fn() };
  const controller = new ChatController(modelProvider as never, store as never, memento as never, { register: vi.fn() } as never, new Diagnostics(), (event) => events.push(event), services as never);
  return { controller, events, model, store };
}

const toolItems = (events: ChatEvent[]) => events
  .filter((event): event is Extract<ChatEvent, { type: 'chat/itemUpdated' }> => event.type === 'chat/itemUpdated')
  .map((event) => event.item as ToolItem);

/** The request array is mutated after the call, so search it instead of taking the last message. */
function toolResultIn(messages: vscode.LanguageModelChatMessage[]): vscode.LanguageModelToolResultPart {
  return messages.flatMap((message) => message.content).find((part) => part instanceof vscode.LanguageModelToolResultPart) as vscode.LanguageModelToolResultPart;
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('ChatController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
  });

  it('asks before running a command, runs it once approved and continues the conversation', async () => {
    const { controller, events, model, store } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo approved-run' })],
      [new vscode.LanguageModelTextPart('All done.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'run it' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    expect(pending.detail).toBe('echo approved-run');

    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'approve' });
    await sending;

    const finished = toolItems(events).filter((item) => item.id === pending.id).pop()!;
    expect(finished.status).toBe('done');
    expect(finished.output).toContain('approved-run');

    const toolResult = toolResultIn(model.sendRequest.mock.calls[1][0]);
    expect((toolResult.content[0] as vscode.LanguageModelTextPart).value).toContain('Exit code 0');
    expect(controller.getState().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'All done.' });
    expect(controller.getState().title).toBe('run it');
    expect(store.save).toHaveBeenCalled();
  });

  it('tells the model when the user rejects a tool call', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo nope' })],
      [new vscode.LanguageModelTextPart('Okay, not running it.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'run it' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'reject' });
    await sending;

    expect(toolItems(events).filter((item) => item.id === pending.id).pop()!.status).toBe('rejected');
    const toolResult = toolResultIn(model.sendRequest.mock.calls[1][0]);
    expect((toolResult.content[0] as vscode.LanguageModelTextPart).value).toContain('rejected');
  });

  it('runs read-only tools without asking in the default approval mode', async () => {
    const { controller, events } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'read_file', { path: 'package.json' })],
      [new vscode.LanguageModelTextPart('Read it.')]
    ]);
    vi.spyOn(vscode.workspace, 'fs', 'get').mockReturnValue({
      readFile: async () => new TextEncoder().encode('{"name":"nova"}')
    } as unknown as vscode.FileSystem);

    await controller.handle({ command: 'chat/send', text: 'read package.json' });

    const items = toolItems(events);
    expect(items.some((item) => item.status === 'awaiting-approval')).toBe(false);
    expect(items.pop()).toMatchObject({ status: 'done', title: 'Read package.json' });
  });

  it('reports unknown tools back to the model as errors', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'delete_everything', {})],
      [new vscode.LanguageModelTextPart('Sorry.')]
    ]);

    await controller.handle({ command: 'chat/send', text: 'go' });

    expect(toolItems(events).pop()?.status).toBe('error');
    const toolResult = toolResultIn(model.sendRequest.mock.calls[1][0]);
    expect((toolResult.content[0] as vscode.LanguageModelTextPart).value).toMatch(/Unknown tool "delete_everything"/);
  });

  it('injects steering messages at the next step of a running reply', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo step' })],
      [new vscode.LanguageModelTextPart('Adjusted as asked.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'do the task' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    await controller.handle({ command: 'chat/send', text: 'also update the README' });
    expect(controller.getState().queue).toMatchObject([{ text: 'also update the README', mode: 'steer' }]);

    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'approve' });
    await sending;

    const secondRequest = model.sendRequest.mock.calls[1][0] as vscode.LanguageModelChatMessage[];
    const texts = secondRequest.flatMap((message) => message.content)
      .filter((part) => part instanceof vscode.LanguageModelTextPart)
      .map((part) => (part as vscode.LanguageModelTextPart).value);
    expect(texts).toContain('also update the README');
    expect(controller.getState().queue).toEqual([]);
    expect(controller.getState().items).toContainEqual(expect.objectContaining({ kind: 'user', text: 'also update the README', steered: true }));
  });

  it('sends queued follow-ups after the reply finishes', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo one' })],
      [new vscode.LanguageModelTextPart('First done.')],
      [new vscode.LanguageModelTextPart('Second done.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'first' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    await controller.handle({ command: 'chat/send', text: 'second' });
    const queued = controller.getState().queue[0];
    await controller.handle({ command: 'chat/queueMode', id: queued.id, mode: 'queue' });

    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'approve' });
    await sending;
    await until(() => model.sendRequest.mock.calls.length === 3 && !controller.getState().running);

    const users = controller.getState().items.filter((item) => item.kind === 'user').map((item) => (item as { text: string }).text);
    expect(users).toEqual(['first', 'second']);
    expect(controller.getState().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Second done.' });
  });

  it('keeps waiting messages after the user stops a reply', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo one' })]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'first' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    await controller.handle({ command: 'chat/send', text: 'later' });
    await controller.handle({ command: 'chat/stop' });
    await sending;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(model.sendRequest).toHaveBeenCalledTimes(1);
    expect(controller.getState().queue).toHaveLength(1);
  });

  it('applies .nova-ai permission rules: deny blocks, allow skips approval, Always allow saves a rule', async () => {
    const rules: Record<string, 'allow' | 'deny'> = { 'rm -rf build': 'deny', 'echo allowed': 'allow' };
    const permissions = {
      decide: vi.fn(async (_tool: string, input: Record<string, unknown>) => rules[String(input.command ?? '')]),
      allow: vi.fn(async () => '/home/.nova-ai/projects/repo-12345678/settings.json')
    };
    const { controller, events } = setup([
      [
        new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'rm -rf build' }),
        new vscode.LanguageModelToolCallPart('c2', 'run_command', { command: 'echo allowed' }),
        new vscode.LanguageModelToolCallPart('c3', 'run_command', { command: 'echo always' })
      ],
      [new vscode.LanguageModelTextPart('Done.')]
    ], 'autoReadOnly', { permissions });

    const sending = controller.handle({ command: 'chat/send', text: 'go' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    expect(pending.detail).toBe('echo always');
    expect(pending.allowRule).toBe('run_command(echo always)');
    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'approveAlways' });
    await sending;

    const final = (callId: string) => toolItems(events).filter((item) => item.callId === callId).pop()!;
    expect(final('c1')).toMatchObject({ status: 'rejected', output: expect.stringContaining('deny rule') });
    expect(final('c2').status).toBe('done');
    expect(toolItems(events).some((item) => item.callId === 'c2' && item.status === 'awaiting-approval')).toBe(false);
    expect(final('c3').status).toBe('done');
    expect(permissions.allow).toHaveBeenCalledWith('run_command(echo always)');
  });

  it('edits an earlier message: drops what followed and resends with the selected model', async () => {
    const { controller, model } = setup([
      [new vscode.LanguageModelTextPart('Answer one.')],
      [new vscode.LanguageModelTextPart('Answer two.')],
      [new vscode.LanguageModelTextPart('Answer two, revised.')]
    ]);

    await controller.handle({ command: 'chat/send', text: 'first question' });
    await controller.handle({ command: 'chat/send', text: 'second question' });
    const second = controller.getState().items.find((item) => item.kind === 'user' && item.text === 'second question')!;

    await controller.handle({ command: 'chat/editMessage', itemId: second.id, text: 'second question, rephrased' });

    const texts = (messages: vscode.LanguageModelChatMessage[]) => messages.slice(1).map((message) =>
      message.content.map((part) => (part as vscode.LanguageModelTextPart).value).join(''));
    expect(texts(model.sendRequest.mock.calls[2][0])).toEqual(['first question', 'Answer one.', 'second question, rephrased', 'Answer two, revised.']);
    expect(controller.getState().items.map((item) => (item as { text?: string }).text)).toEqual([
      'first question', 'Answer one.', 'second question, rephrased', 'Answer two, revised.'
    ]);
  });

  it('stops a running reply before resending an edited message', async () => {
    const { controller, events, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo slow' })],
      [new vscode.LanguageModelTextPart('Edited answer.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'original' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    const original = controller.getState().items.find((item) => item.kind === 'user')!;

    await controller.handle({ command: 'chat/editMessage', itemId: original.id, text: 'edited' });
    await sending;

    expect(model.sendRequest).toHaveBeenCalledTimes(2);
    const items = controller.getState().items;
    expect(items.filter((item) => item.kind === 'user').map((item) => (item as { text: string }).text)).toEqual(['edited']);
    expect(items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Edited answer.' });
  });

  it('renames the open chat in memory and on disk, and other chats through the store', async () => {
    const { controller, store } = setup([[new vscode.LanguageModelTextPart('Hi.')]]);
    await controller.handle({ command: 'chat/send', text: 'hello' });
    const id = controller.currentSessionId;
    store.list.mockReturnValue([{ id, title: 'hello', updatedAt: 1 }]);
    store.save.mockClear();

    await controller.handle({ command: 'chat/rename', sessionId: id, title: '  My chat  ' });
    expect(controller.getState().title).toBe('My chat');
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id, title: 'My chat' }));

    await controller.handle({ command: 'chat/rename', sessionId: 'other', title: 'Other' });
    expect(store.rename).toHaveBeenCalledWith('other', 'Other');
    await controller.handle({ command: 'chat/rename', sessionId: 'other', title: '   ' });
    await controller.handle({ command: 'chat/rename', sessionId: 'other', title: 'x'.repeat(201) });
    expect(store.rename).toHaveBeenCalledTimes(1);
  });

  it('keeps the new name when the open chat is renamed while Nova is working', async () => {
    const { controller, events, store } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo slow' })],
      [new vscode.LanguageModelTextPart('Done.')]
    ]);
    const sending = controller.handle({ command: 'chat/send', text: 'original title' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    store.list.mockReturnValue([{ id: controller.currentSessionId, title: 'original title', updatedAt: 1 }]);

    await controller.renameSession(controller.currentSessionId, 'Renamed');
    const pending = toolItems(events).find((item) => item.status === 'awaiting-approval')!;
    await controller.handle({ command: 'chat/approval', itemId: pending.id, decision: 'approve' });
    await sending;

    expect(store.save.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Renamed' });
  });

  it('deleting the chat Nova is working in stops it, lets it save, then starts a new chat', async () => {
    const { controller, events, store } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo slow' })]
    ]);
    const sending = controller.handle({ command: 'chat/send', text: 'doomed' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));
    const id = controller.currentSessionId;

    await controller.deleteSessions([id, 'other']);
    await sending;

    expect(store.delete).toHaveBeenCalledWith(id);
    expect(store.delete).toHaveBeenCalledWith('other');
    // The stopped reply was saved before the delete, never into the new chat.
    const lastDelete = Math.max(...store.delete.mock.invocationCallOrder);
    expect(store.save.mock.invocationCallOrder.every((order) => order < lastDelete)).toBe(true);
    expect(store.save.mock.calls.every(([session]) => session.id === id)).toBe(true);
    expect(controller.currentSessionId).not.toBe(id);
    expect(controller.getState()).toMatchObject({ items: [], running: false });
  });

  it('lists saved chats in the state and deletes them only after confirmation', async () => {
    const { controller, store } = setup([]);
    store.list.mockReturnValue([{ id: 'a', title: 'Alpha', updatedAt: 2 }, { id: 'b', title: 'Beta', updatedAt: 1 }]);
    expect(controller.getState().sessions.map((chat) => chat.id)).toEqual(['a', 'b']);

    const confirm = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce(undefined as never);
    await controller.handle({ command: 'chat/delete', sessionIds: ['a', 'b'] });
    expect(confirm).toHaveBeenCalledWith('Delete 2 chats?', expect.objectContaining({ modal: true }), 'Delete');
    expect(store.delete).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce('Delete' as never);
    await controller.handle({ command: 'chat/delete', sessionIds: ['a', 'unknown'] });
    expect(confirm).toHaveBeenLastCalledWith('Delete the chat "Alpha"?', expect.anything(), 'Delete');
    expect(store.delete.mock.calls).toEqual([['a']]);
  });

  it('opens a saved chat', async () => {
    const { controller, store } = setup([]);
    store.load.mockResolvedValue({ id: 'saved', title: 'Saved chat', createdAt: 1, updatedAt: 1, items: [{ kind: 'user', id: 'u1', text: 'hi', attachments: [] }], messages: [] });
    await controller.handle({ command: 'chat/open', sessionId: 'saved' });
    expect(controller.getState()).toMatchObject({ sessionId: 'saved', title: 'Saved chat' });
  });

  it('opens links from replies: web links after confirmation, paths in the workspace, other schemes never', async () => {
    const { controller } = setup([]);
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    const open = vi.spyOn(vscode.env, 'openExternal');
    const show = vi.spyOn(vscode.window, 'showTextDocument');

    await controller.handle({ command: 'chat/openLink', href: 'https://example.com/', text: 'Example' });
    expect(warn).toHaveBeenLastCalledWith('Open example.com in your browser?', expect.objectContaining({ modal: true }), 'Open in Browser', 'Copy Link');
    expect(open).not.toHaveBeenCalled();

    await controller.handle({ command: 'chat/openLink', href: 'command:workbench.action.terminal.new', text: 'run' });
    expect(warn).toHaveBeenLastCalledWith('Nova does not open command: links from the chat.');

    await controller.handle({ command: 'chat/openLink', href: 'package.json#L3', text: 'package.json' });
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ fsPath: expect.stringContaining('package.json') }), expect.objectContaining({ selection: expect.objectContaining({ start: { line: 2, character: 0 } }) }));
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses to switch chats while Nova is working', async () => {
    const { controller, events, store } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'run_command', { command: 'echo slow' })]
    ]);
    const info = vi.spyOn(vscode.window, 'showInformationMessage');
    const sending = controller.handle({ command: 'chat/send', text: 'busy' });
    await until(() => toolItems(events).some((item) => item.status === 'awaiting-approval'));

    expect(await controller.openSession('elsewhere')).toBe(false);
    expect(store.load).not.toHaveBeenCalledWith('elsewhere');
    expect(info).toHaveBeenCalled();
    expect(await controller.openSession(controller.currentSessionId)).toBe(true);

    await controller.handle({ command: 'chat/stop' });
    await sending;
  });

  it('lists the skills that are on in the system prompt and offers load_skill', async () => {
    const base = mkdtempSync(join(tmpdir(), 'nova-panel-skills-'));
    try {
      const novaHome = join(base, '.nova-ai');
      for (const [name, description] of [['review', 'Review a pull request.'], ['deploy', 'Deploy the app.']]) {
        mkdirSync(join(novaHome, 'skills', name), { recursive: true });
        writeFileSync(join(novaHome, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nsteps`);
      }
      writeFileSync(join(novaHome, 'settings.json'), JSON.stringify({ skills: { disabled: ['deploy'] } }));
      const skillPaths = () => ({ home: base, novaHome, workspaceRoots: [] });
      const { controller, model } = setup([[new vscode.LanguageModelTextPart('Ok.')]], 'autoReadOnly', { skillPaths });

      await controller.handle({ command: 'chat/send', text: 'review this' });

      const [messages, options] = model.sendRequest.mock.calls[0];
      const system = JSON.stringify(messages[0].content);
      expect(system).toContain('- review: Review a pull request.');
      expect(system).not.toContain('deploy');
      expect(options.tools.map((tool: { name: string }) => tool.name)).toContain('load_skill');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('keeps a task list from todo_write without adding tool cards', async () => {
    const { controller, events } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'todo_write', { todos: [
        { content: 'Read the code', status: 'completed' },
        { content: 'Write the fix', status: 'in_progress' },
        { content: 'Run tests', status: 'pending' }
      ] })],
      [new vscode.LanguageModelTextPart('Working on it.')]
    ]);

    await controller.handle({ command: 'chat/send', text: 'fix the bug' });

    expect(controller.getState().todos).toEqual([
      { content: 'Read the code', status: 'completed' },
      { content: 'Write the fix', status: 'in_progress' },
      { content: 'Run tests', status: 'pending' }
    ]);
    expect(controller.getState().items.some((item) => item.kind === 'tool')).toBe(false);
    expect(events.some((event) => event.type === 'chat/todos')).toBe(true);

    await controller.handle({ command: 'chat/dismissTodos' });
    expect(controller.getState().todos).toEqual([]);
  });

  it('asks the user a question and returns the chosen option to the model', async () => {
    const { controller, model } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'ask_user', {
        question: 'Which database?',
        options: [
          { label: 'PostgreSQL', description: 'Relational, needs a server', recommended: true },
          { label: 'SQLite', description: 'File based, zero setup', recommended: true }
        ]
      })],
      [new vscode.LanguageModelTextPart('Going with PostgreSQL.')]
    ]);

    const sending = controller.handle({ command: 'chat/send', text: 'set up storage' });
    await until(() => controller.getState().items.some((item) => item.kind === 'question'));
    const question = controller.getState().items.find((item) => item.kind === 'question')!;
    expect(question).toMatchObject({ status: 'pending', multiSelect: false, allowOther: true });
    // A single-choice question keeps only the first recommendation.
    expect((question as { options: Array<{ recommended?: boolean }> }).options.map((option) => Boolean(option.recommended))).toEqual([true, false]);

    await controller.handle({ command: 'chat/answer', itemId: question.id, answer: 'PostgreSQL' });
    await sending;

    expect(controller.getState().items.find((item) => item.kind === 'question')).toMatchObject({ status: 'answered', answer: 'PostgreSQL' });
    expect((toolResultIn(model.sendRequest.mock.calls[1][0]).content[0] as vscode.LanguageModelTextPart).value).toBe('The user answered: PostgreSQL');
  });

  it('treats a typed message as the answer, and a skip as "decide yourself"', async () => {
    const typed = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'ask_user', { question: 'Name for the module?' })],
      [new vscode.LanguageModelTextPart('ok')]
    ]);
    const sending = typed.controller.handle({ command: 'chat/send', text: 'create a module' });
    await until(() => typed.controller.getState().items.some((item) => item.kind === 'question'));
    await typed.controller.handle({ command: 'chat/send', text: 'billing' });
    await sending;
    expect((toolResultIn(typed.model.sendRequest.mock.calls[1][0]).content[0] as vscode.LanguageModelTextPart).value).toBe('The user answered: billing');
    expect(typed.controller.getState().queue).toEqual([]);

    const skipped = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'ask_user', { question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] })],
      [new vscode.LanguageModelTextPart('ok')]
    ]);
    const skipping = skipped.controller.handle({ command: 'chat/send', text: 'format it' });
    await until(() => skipped.controller.getState().items.some((item) => item.kind === 'question'));
    const question = skipped.controller.getState().items.find((item) => item.kind === 'question')!;
    await skipped.controller.handle({ command: 'chat/skipQuestion', itemId: question.id });
    await skipping;
    expect((toolResultIn(skipped.model.sendRequest.mock.calls[1][0]).content[0] as vscode.LanguageModelTextPart).value).toMatch(/skipped the question/);
  });

  it('shows an inline diff for edits and tracks changed files for keep and undo', async () => {
    const files = new Map<string, string>();
    vi.spyOn(vscode.workspace, 'fs', 'get').mockReturnValue({
      stat: async (uri: vscode.Uri) => { if (!files.has(uri.fsPath)) throw new Error('missing'); return {}; },
      readFile: async (uri: vscode.Uri) => new TextEncoder().encode(files.get(uri.fsPath) ?? ''),
      writeFile: async (uri: vscode.Uri, data: Uint8Array) => void files.set(uri.fsPath, new TextDecoder().decode(data)),
      delete: async (uri: vscode.Uri) => void files.delete(uri.fsPath)
    } as never);
    const { controller } = setup([
      [new vscode.LanguageModelToolCallPart('c1', 'create_file', { path: 'notes/new.md', content: '# Notes\nfirst\n' })],
      [new vscode.LanguageModelTextPart('Created.')]
    ], 'autoAll');

    await controller.handle({ command: 'chat/send', text: 'write notes' });

    const card = controller.getState().items.find((item) => item.kind === 'tool')!;
    expect(card).toMatchObject({ status: 'done', diff: { added: 2, removed: 0 } });
    expect(controller.getState().changes).toEqual([{ path: 'notes/new.md', added: 2, removed: 0, created: true }]);

    await controller.handle({ command: 'chat/undoChange', path: 'notes/new.md' });
    expect([...files.keys()].some((key) => key.endsWith('notes/new.md'))).toBe(false);
    expect(controller.getState().changes).toEqual([]);
  });

  describe('slash commands', () => {
    const textOf = (message: vscode.LanguageModelChatMessage) => message.content
      .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ''))
      .join('');
    const notices = (controller: ChatController) => controller.getState().items.filter((item) => item.kind === 'notice').map((item) => item.text);

    it('/clear starts a new chat without asking the model', async () => {
      const { controller, model } = setup([[new vscode.LanguageModelTextPart('Hello.')]]);
      await controller.handle({ command: 'chat/send', text: 'hi' });
      const first = controller.getState().sessionId;

      await controller.handle({ command: 'chat/send', text: '/clear' });

      expect(controller.getState()).toMatchObject({ items: [], title: 'New chat' });
      expect(controller.getState().sessionId).not.toBe(first);
      expect(model.sendRequest).toHaveBeenCalledTimes(1);
    });

    it('/compact replaces the conversation with a summary that later messages build on', async () => {
      const { controller, model } = setup([
        [new vscode.LanguageModelTextPart('Hello.')],
        [new vscode.LanguageModelTextPart('Goal: say hi.')],
        [new vscode.LanguageModelTextPart('Next.')]
      ]);
      await controller.handle({ command: 'chat/send', text: 'hi' });
      await controller.handle({ command: 'chat/send', text: '/compact the greeting' });

      const compaction = textOf(model.sendRequest.mock.calls[1][0][0]);
      expect(compaction).toContain('User:\nhi');
      expect(compaction).toContain('Focus the summary on: the greeting');
      expect(notices(controller).pop()).toMatch(/^Conversation compacted/);
      // The chat stays visible.
      expect(controller.getState().items.filter((item) => item.kind === 'user' || item.kind === 'assistant')).toHaveLength(2);

      await controller.handle({ command: 'chat/send', text: 'and now?' });
      const sent = (model.sendRequest.mock.calls[2][0] as vscode.LanguageModelChatMessage[]).slice(1).map(textOf);
      expect(sent[0]).toContain('<conversation-summary>');
      expect(sent[0]).toContain('Goal: say hi.');
      expect(sent.some((text) => text === 'hi')).toBe(false);
      expect(sent).toContain('and now?');
    });

    it('/compact says so when there is nothing to compact', async () => {
      const { controller, model } = setup([]);
      await controller.handle({ command: 'chat/send', text: '/compact' });
      expect(notices(controller)).toEqual(['Nothing to compact yet.']);
      expect(model.sendRequest).not.toHaveBeenCalled();
    });

    it('/model lists the models and reports names that match none', async () => {
      const { controller } = setup([]);
      await controller.handle({ command: 'chat/send', text: '/model' });
      await controller.handle({ command: 'chat/send', text: '/model gpt' });
      await controller.handle({ command: 'chat/send', text: '/model nova test' });
      expect(notices(controller)).toEqual([
        'Models (switch with /model <name>):\n● Nova Test',
        'No model matches "gpt". Models:\n● Nova Test',
        'Model: Nova Test'
      ]);
    });

    it('/help opens the help page', async () => {
      const { controller } = setup([]);
      const execute = vi.spyOn(vscode.commands, 'executeCommand');
      await controller.handle({ command: 'chat/send', text: '/help' });
      expect(execute).toHaveBeenCalledWith('nova.showHelp');
      expect(controller.getState().items).toEqual([]);
    });

    it('/rename renames the chat; unknown commands and paths are sent as messages', async () => {
      const { controller, model } = setup([[new vscode.LanguageModelTextPart('ok')], [new vscode.LanguageModelTextPart('ok')]]);
      await controller.handle({ command: 'chat/send', text: '/rename  Release prep ' });
      expect(controller.getState().title).toBe('Release prep');

      await controller.handle({ command: 'chat/send', text: '/deploy now' });
      await controller.handle({ command: 'chat/send', text: '/etc/hosts looks wrong' });
      expect(model.sendRequest).toHaveBeenCalledTimes(2);
      expect(controller.getState().items.filter((item) => item.kind === 'user').map((item) => item.text)).toEqual(['/deploy now', '/etc/hosts looks wrong']);
    });
  });
});
