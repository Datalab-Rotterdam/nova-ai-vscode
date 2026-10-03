import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { MemoryChange, MemoryPlan, MemoryScope, MemoryService, NoteType } from '../../memory/MemoryService';
import { NovaTool, ToolInputError, type ToolPreparation } from './types';

interface MemoryReadInput { scope?: MemoryScope; name?: string }
interface MemoryWriteInput {
    action: MemoryChange['action'];
    scope: MemoryScope;
    text?: string;
    match?: string;
    name?: string;
    description?: string;
    type?: NoteType;
    content?: string;
}

const SCOPE_SCHEMA = {
    type: 'string',
    enum: ['global', 'project'],
    description: 'global: about the user, for all projects. project: about this workspace only.'
};

/** Tools to read and update Nova's memory files in ~/.nova-ai. */
export function createMemoryTools(memory: MemoryService): NovaTool<never>[] {
    const read: NovaTool<MemoryReadInput> = {
        name: 'memory_read',
        description: 'Read Nova\'s saved memory: without name, the MEMORY.md of a scope (or both; also included at the start of each chat); with name, that memory note.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: SCOPE_SCHEMA,
                name: { type: 'string', description: 'Name of a memory note to read.' }
            }
        },
        readOnly: true,
        async prepare(input) {
            return { title: input.name ? `Read memory note ${input.name}` : `Read ${input.scope ?? 'all'} memory` };
        },
        async invoke(input) {
            if (typeof input.name === 'string' && input.name) {
                const found = await memory.readNote(input.name, input.scope ? parseScope(input.scope) : undefined);
                if (!found) {
                    throw new ToolInputError(`Unknown memory note: ${input.name}.`);
                }
                return `Memory note: ${found.note.name} [${found.note.type}/${found.note.scope}]\n\n${found.content}`;
            }
            const scopes: MemoryScope[] = input.scope ? [parseScope(input.scope)] : ['project', 'global'];
            const parts = await Promise.all(scopes.map(async (scope) => `## ${scope}\n${await memory.read(scope) || '(empty)'}`));
            return parts.join('\n\n');
        }
    };

    const write: NovaTool<MemoryWriteInput> = {
        name: 'memory_write',
        description:
            'Change memory that persists across chats. Keep it small and current: one short fact per entry, no secrets or personal data. ' +
            'Actions: "remember" adds a fact (text); "replace" updates entries containing match with text (use it when a fact changed, ' +
            'instead of adding a contradicting one); "forget" removes entries containing match; "rewrite" replaces all entries with ' +
            'text (one entry per line) to consolidate duplicates and drop outdated ones; "save_note" creates or updates a longer typed note ' +
            '(name, description, type, content) linked from MEMORY.md; "delete_note" removes one. Scope global is about the user, scope project about this workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['remember', 'replace', 'forget', 'rewrite', 'save_note', 'delete_note'] },
                scope: SCOPE_SCHEMA,
                text: { type: 'string', description: 'remember/replace: the fact. rewrite: all entries, one per line.' },
                match: { type: 'string', description: 'replace/forget: text identifying the entries to change.' },
                name: { type: 'string', description: 'save_note/delete_note: lowercase kebab-case note name.' },
                description: { type: 'string', description: 'save_note: one-line summary shown in every chat.' },
                type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
                content: { type: 'string', description: 'save_note: the note.' }
            },
            required: ['action', 'scope']
        },
        // Memory persists into future prompts, so changes need the user's approval (shown as a diff).
        readOnly: false,
        async prepare(input) {
            const scope = parseScope(input.scope);
            const plan = await memory.plan(scope, toChange(input));
            const exists = await fs.access(memory.file(scope)).then(() => true, () => false);
            if (plan.note?.proposed !== undefined) {
                // save_note: the note itself is what the user approves.
                return {
                    title: plan.summary.split('\n')[0],
                    detail: input.description?.trim(),
                    edit: {
                        uri: vscode.Uri.file(plan.note.path),
                        path: `${scope === 'global' ? 'Global' : 'Project'} memory note (${input.name}.md)`,
                        original: plan.note.original ?? '',
                        proposed: plan.note.proposed,
                        isNewFile: plan.note.original === undefined
                    },
                    plan
                } as ToolPreparation & { plan: MemoryPlan };
            }
            return {
                title: plan.summary.split('\n')[0],
                detail: input.action === 'rewrite' || input.action === 'delete_note' ? input.name : (input.text ?? input.match)?.trim(),
                edit: plan.proposed === plan.original ? undefined : {
                    uri: vscode.Uri.file(memory.file(scope)),
                    path: `${scope === 'global' ? 'Global' : 'Project'} memory (MEMORY.md)`,
                    original: plan.original,
                    proposed: plan.proposed,
                    isNewFile: !exists
                },
                plan
            } as ToolPreparation & { plan: MemoryPlan };
        },
        async invoke(input, _context, preparation) {
            const scope = parseScope(input.scope);
            const plan = (preparation as ToolPreparation & { plan?: MemoryPlan }).plan ?? await memory.plan(scope, toChange(input));
            await memory.apply(scope, plan);
            return plan.summary;
        }
    };

    return [read, write] as unknown as NovaTool<never>[];
}

function toChange(input: MemoryWriteInput): MemoryChange {
    const text = typeof input.text === 'string' ? input.text : '';
    const match = typeof input.match === 'string' ? input.match : '';
    switch (input.action) {
        case 'remember':
            if (!text.trim()) {
                throw new ToolInputError('"text" is required to remember something.');
            }
            return { action: 'remember', text };
        case 'forget':
            // Older calls passed the entry to forget as "text".
            if (!(match || text).trim()) {
                throw new ToolInputError('"match" is required to forget entries.');
            }
            return { action: 'forget', match: match || text };
        case 'replace':
            if (!match.trim() || !text.trim()) {
                throw new ToolInputError('"match" and "text" are required to replace an entry.');
            }
            return { action: 'replace', match, text };
        case 'rewrite':
            if (!text.trim()) {
                throw new ToolInputError('"text" with the new entries is required; use forget to remove single entries.');
            }
            return { action: 'rewrite', text };
        case 'save_note':
            return {
                action: 'save_note',
                name: typeof input.name === 'string' ? input.name : '',
                description: typeof input.description === 'string' ? input.description : '',
                type: input.type as NoteType,
                content: typeof input.content === 'string' ? input.content : ''
            };
        case 'delete_note':
            return { action: 'delete_note', name: typeof input.name === 'string' ? input.name : '' };
        default:
            throw new ToolInputError('"action" must be remember, replace, forget, rewrite, save_note or delete_note.');
    }
}

function parseScope(value: unknown): MemoryScope {
    if (value === 'global' || value === 'project') {
        return value;
    }
    throw new ToolInputError('"scope" must be "global" or "project".');
}
