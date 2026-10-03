import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureDir, writePrivateFile } from '../storage/NovaHome';
import type { ChatItem, SessionSummary, TodoItem } from './protocol';

/** Model conversation in a JSON-safe form. */
export type StoredPart =
    | { type: 'text'; value: string }
    | { type: 'toolCall'; callId: string; name: string; input: object }
    | { type: 'toolResult'; callId: string; text: string };

export interface StoredMessage {
    role: 'user' | 'assistant';
    parts: StoredPart[];
}

export interface StoredSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    modelId?: string;
    /** What the panel shows. */
    items: ChatItem[];
    /** What the model sees (after compaction), without the system prompt. */
    messages: StoredMessage[];
    /** Nova's task list, if any. */
    todos?: TodoItem[];
}

const MAX_SESSIONS = 50;
const INDEX_FILE = 'index.json';

/** Keys of the pre-~/.nova-ai storage in VS Code's workspace storage. */
const LEGACY_INDEX_KEY = 'nova.chat.sessions';
const LEGACY_MIGRATED_KEY = 'nova.chat.sessionsMigrated';

/**
 * Persists panel conversations per workspace in `~/.nova-ai/projects/<key>/sessions`:
 * an `index.json` plus one JSON file per session. The index is cached in memory so the
 * history list renders without disk access.
 */
export class SessionStore {
    private index: SessionSummary[] = [];

    private constructor(private readonly dir: string) {
    }

    public static async open(dir: string): Promise<SessionStore> {
        const store = new SessionStore(dir);
        try {
            const parsed = JSON.parse(await fs.readFile(path.join(dir, INDEX_FILE), 'utf8')) as unknown;
            store.index = Array.isArray(parsed) ? parsed.filter(isSummary) : [];
        } catch {
            store.index = [];
        }
        return store;
    }

    public list(): SessionSummary[] {
        return [...this.index].sort((left, right) => right.updatedAt - left.updatedAt);
    }

    public async load(id: string): Promise<StoredSession | undefined> {
        try {
            return JSON.parse(await fs.readFile(this.fileFor(id), 'utf8')) as StoredSession;
        } catch {
            return undefined;
        }
    }

    public async save(session: StoredSession): Promise<void> {
        await writePrivateFile(this.fileFor(session.id), JSON.stringify(session));

        const summaries = this.list().filter((summary) => summary.id !== session.id);
        summaries.unshift({ id: session.id, title: session.title, updatedAt: session.updatedAt });
        for (const dropped of summaries.slice(MAX_SESSIONS)) {
            await this.deleteFile(dropped.id);
        }
        this.index = summaries.slice(0, MAX_SESSIONS);
        await this.writeIndex();
    }

    public async delete(id: string): Promise<void> {
        await this.deleteFile(id);
        this.index = this.index.filter((summary) => summary.id !== id);
        await this.writeIndex();
    }

    /**
     * Copies sessions from the old location (VS Code workspace storage) once.
     * The old files are left in place, so downgrading keeps working.
     */
    public async migrateLegacy(state: vscode.Memento, legacyStorage: vscode.Uri | undefined): Promise<number> {
        if (!legacyStorage || state.get<boolean>(LEGACY_MIGRATED_KEY)) {
            return 0;
        }

        let migrated = 0;
        for (const summary of state.get<SessionSummary[]>(LEGACY_INDEX_KEY, [])) {
            if (!isSummary(summary) || this.index.some((existing) => existing.id === summary.id)) {
                continue;
            }
            try {
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(legacyStorage, 'chat-sessions', `${summary.id}.json`));
                const session = JSON.parse(new TextDecoder().decode(bytes)) as StoredSession;
                await writePrivateFile(this.fileFor(session.id), JSON.stringify(session));
                this.index.push({ id: session.id, title: session.title, updatedAt: session.updatedAt });
                migrated++;
            } catch {
                // unreadable legacy session: skip
            }
        }

        if (migrated) {
            this.index = this.list().slice(0, MAX_SESSIONS);
            await this.writeIndex();
        }
        await state.update(LEGACY_MIGRATED_KEY, true);
        return migrated;
    }

    private async writeIndex(): Promise<void> {
        await ensureDir(this.dir);
        await writePrivateFile(path.join(this.dir, INDEX_FILE), JSON.stringify(this.index, null, 2));
    }

    private async deleteFile(id: string): Promise<void> {
        await fs.rm(this.fileFor(id), { force: true });
    }

    private fileFor(id: string): string {
        if (!/^[\w-]+$/.test(id)) {
            throw new Error(`Invalid session id: ${id}`);
        }
        return path.join(this.dir, `${id}.json`);
    }
}

function isSummary(value: unknown): value is SessionSummary {
    return typeof value === 'object' && value !== null
        && typeof (value as SessionSummary).id === 'string'
        && typeof (value as SessionSummary).title === 'string'
        && typeof (value as SessionSummary).updatedAt === 'number';
}

export function toStoredMessages(messages: readonly vscode.LanguageModelChatMessage[]): StoredMessage[] {
    return messages.map((message) => ({
        role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
        parts: message.content.flatMap((part): StoredPart[] => {
            if (part instanceof vscode.LanguageModelTextPart) {
                return [{ type: 'text', value: part.value }];
            }
            if (part instanceof vscode.LanguageModelToolCallPart) {
                return [{ type: 'toolCall', callId: part.callId, name: part.name, input: part.input }];
            }
            if (part instanceof vscode.LanguageModelToolResultPart) {
                const text = part.content
                    .map((item) => (item instanceof vscode.LanguageModelTextPart ? item.value : ''))
                    .join('\n');
                return [{ type: 'toolResult', callId: part.callId, text }];
            }
            return [];
        })
    }));
}

export function fromStoredMessages(messages: readonly StoredMessage[]): vscode.LanguageModelChatMessage[] {
    return messages.map((message) => {
        const content = message.parts.map((part) => {
            switch (part.type) {
                case 'text':
                    return new vscode.LanguageModelTextPart(part.value);
                case 'toolCall':
                    return new vscode.LanguageModelToolCallPart(part.callId, part.name, part.input);
                case 'toolResult':
                    return new vscode.LanguageModelToolResultPart(part.callId, [new vscode.LanguageModelTextPart(part.text)]);
            }
        });
        return message.role === 'assistant'
            ? vscode.LanguageModelChatMessage.Assistant(content as Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>)
            : vscode.LanguageModelChatMessage.User(content as Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart>);
    });
}
