import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

let currentModel: unknown;
vi.mock('../src/panel/directModel', () => ({ createDirectModel: () => currentModel }));

import { Diagnostics } from '../src/core/diagnostics';
import { ChatController, type ChatControllerOptions } from '../src/panel/ChatController';
import { ChatHub } from '../src/panel/ChatHub';
import type { ChatEvent } from '../src/panel/protocol';
import type { StoredSession } from '../src/panel/SessionStore';

/** In-memory SessionStore with the same contract. */
function memoryStore(sessions: StoredSession[] = []) {
    const files = new Map(sessions.map((session) => [session.id, structuredClone(session)]));
    const changed = new vscode.EventEmitter<void>();
    return {
        files,
        onDidChange: changed.event,
        list: () => [...files.values()].map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt),
        load: vi.fn(async (id: string) => structuredClone(files.get(id))),
        save: vi.fn(async (session: StoredSession) => { files.set(session.id, structuredClone(session)); changed.fire(); }),
        rename: vi.fn(async (id: string, title: string) => {
            const session = files.get(id);
            if (session) { session.title = title; changed.fire(); }
            return Boolean(session);
        }),
        delete: vi.fn(async (id: string) => { files.delete(id); changed.fire(); })
    };
}

const saved = (id: string, title: string): StoredSession => ({
    id, title, createdAt: 1, updatedAt: 1, messages: [],
    items: [{ kind: 'user', id: `${id}-u`, text: title, attachments: [] }]
});

function model(responses: vscode.LanguageModelTextPart[][]) {
    const sendRequest = vi.fn();
    for (const response of responses) {
        sendRequest.mockImplementationOnce(async () => ({ stream: (async function* () { yield* response; })() }));
    }
    return { id: 'nova-test', name: 'Nova Test', vendor: 'nova-ai', maxInputTokens: 100_000, sendRequest };
}

function world(sessions: StoredSession[] = [], lastSession?: string) {
    currentModel = model([[new vscode.LanguageModelTextPart('Hi.')]]);
    const modelProvider = {
        onDidChangeLanguageModelChatInformation: () => ({ dispose: () => undefined }),
        listModels: async () => [{ id: 'nova-test', name: 'Nova Test', maxInputTokens: 100_000, isDefault: true }]
    };
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: <T>(_key: string, fallback: T) => fallback,
        update: vi.fn()
    } as unknown as vscode.WorkspaceConfiguration);
    const store = memoryStore(sessions);
    const memento = new Map<string, unknown>(lastSession ? [['nova.chat.lastSession', lastSession]] : []);
    const workspaceState = { get: (key: string) => memento.get(key), update: vi.fn(async (key: string, value: unknown) => void memento.set(key, value)) };
    const hub = new ChatHub();
    const make = (options: ChatControllerOptions = {}) => {
        const events: ChatEvent[] = [];
        const reveal = vi.fn();
        const controller = new ChatController(modelProvider as never, store as never, workspaceState as never, { register: vi.fn() } as never, new Diagnostics(), (event) => events.push(event), {}, { reveal, ...options, hub });
        hub.add(controller);
        return { controller, events, reveal };
    };
    return { store, memento, workspaceState, hub, make };
}

describe('several chats at once (sidebar and editor tabs)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('opens a chat in one place only: asking elsewhere shows where it is', async () => {
        const { make } = world([saved('a', 'Alpha'), saved('b', 'Beta')]);
        const sidebar = make();
        const tab = make({ rememberLast: false, initialSessionId: 'a' });
        await tab.controller.handle({ command: 'chat/ready' });
        await sidebar.controller.handle({ command: 'chat/ready' });

        expect(tab.controller.currentSessionId).toBe('a');
        expect(await sidebar.controller.openSession('a')).toBe(false);
        expect(tab.reveal).toHaveBeenCalled();
        expect(sidebar.controller.currentSessionId).not.toBe('a');
        expect(sidebar.controller.getState().openElsewhere).toEqual(['a']);
        expect(await sidebar.controller.openSession('b')).toBe(true);
        expect(tab.controller.getState().openElsewhere).toEqual(['b']);
    });

    it('a restored tab does not take the chat the sidebar already shows, and tabs do not become "last"', async () => {
        const { make, workspaceState } = world([saved('a', 'Alpha')], 'a');
        const sidebar = make();
        await sidebar.controller.handle({ command: 'chat/ready' });
        expect(sidebar.controller.currentSessionId).toBe('a');

        const tab = make({ rememberLast: false, initialSessionId: 'a' });
        await tab.controller.handle({ command: 'chat/ready' });
        expect(tab.controller.currentSessionId).not.toBe('a');
        expect(tab.controller.getState().items).toEqual([]);

        workspaceState.update.mockClear();
        await tab.controller.handle({ command: 'chat/send', text: 'in a tab' });
        expect(workspaceState.update).not.toHaveBeenCalled();
    });

    it('renaming a chat open in another tab renames it there, so its next save keeps the name', async () => {
        const { make, store } = world([saved('a', 'Alpha')]);
        const sidebar = make();
        const tab = make({ rememberLast: false, initialSessionId: 'a' });
        await tab.controller.handle({ command: 'chat/ready' });
        await sidebar.controller.handle({ command: 'chat/ready' });

        await sidebar.controller.handle({ command: 'chat/rename', sessionId: 'a', title: 'Renamed' });
        expect(tab.controller.title).toBe('Renamed');
        expect(store.files.get('a')?.title).toBe('Renamed');
        expect(store.rename).not.toHaveBeenCalled();
    });

    it('deleting a chat open in another tab gives that tab a new chat', async () => {
        const { make, store } = world([saved('a', 'Alpha')]);
        const sidebar = make();
        const tab = make({ rememberLast: false, initialSessionId: 'a' });
        await tab.controller.handle({ command: 'chat/ready' });
        await sidebar.controller.handle({ command: 'chat/ready' });

        await sidebar.controller.deleteSessions(['a']);
        expect(store.files.has('a')).toBe(false);
        expect(tab.controller.currentSessionId).not.toBe('a');
        expect(tab.controller.getState().items).toEqual([]);
    });

    it('tells every surface when the chat list changes, with what is open elsewhere', async () => {
        const { make } = world();
        const sidebar = make();
        const tab = make({ rememberLast: false, initialSessionId: null });
        await sidebar.controller.handle({ command: 'chat/ready' });
        await tab.controller.handle({ command: 'chat/ready' });

        await tab.controller.handle({ command: 'chat/send', text: 'hello from the tab' });
        const update = sidebar.events.filter((event) => event.type === 'chat/sessions').pop() as Extract<ChatEvent, { type: 'chat/sessions' }>;
        expect(update.sessions.map((chat) => chat.title)).toEqual(['hello from the tab']);
        expect(update.openElsewhere).toEqual([tab.controller.currentSessionId]);
    });

    it('moving a chat to a tab sends its events there and stops it being the sidebar\'s "last" chat', async () => {
        const { make, workspaceState, memento } = world([saved('a', 'Alpha')], 'a');
        const sidebar = make();
        await sidebar.controller.handle({ command: 'chat/ready' });
        const titles: string[] = [];
        const tabEvents: ChatEvent[] = [];

        await sidebar.controller.forgetLast();
        sidebar.controller.moveTo((event) => tabEvents.push(event), { onTitle: (title) => titles.push(title) });
        expect(memento.get('nova.chat.lastSession')).toBeUndefined();
        expect(tabEvents.at(-1)).toMatchObject({ type: 'chat/state', state: { sessionId: 'a', title: 'Alpha' } });
        expect(titles.at(-1)).toBe('Alpha');

        sidebar.events.length = 0;
        workspaceState.update.mockClear();
        await sidebar.controller.handle({ command: 'chat/send', text: 'continue' });
        expect(sidebar.events).toEqual([]);
        expect(workspaceState.update).not.toHaveBeenCalled();
    });

    it('reports the first question as the title (the tab name)', async () => {
        const { make } = world();
        const titles: string[] = [];
        const tab = make({ rememberLast: false, initialSessionId: null, onTitle: (title) => titles.push(title) });
        await tab.controller.handle({ command: 'chat/send', text: 'How does the login flow work?' });
        expect(titles.at(-1)).toBe('How does the login flow work?');
    });
});
