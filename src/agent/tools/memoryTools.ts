import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { MemoryChange, MemoryPlan, MemoryScope, MemoryService } from '../../memory/MemoryService';
import { NovaTool, ToolInputError, type ToolPreparation } from './types';

interface MemoryReadInput { scope?: MemoryScope }
interface MemoryWriteInput { action: MemoryChange['action']; scope: MemoryScope; text?: string; match?: string }

const SCOPE_SCHEMA = {
    type: 'string',
    enum: ['global', 'project'],
    description: 'global: about the user, for all projects. project: about this workspace only.'
};

/** Tools to read and update Nova's memory files in ~/.nova-ai. */
export function createMemoryTools(memory: MemoryService): NovaTool<never>[] {
    const read: NovaTool<MemoryReadInput> = {
        name: 'memory_read',
        description: 'Read Nova\'s saved memory (global and/or project). Memory is also included at the start of each chat.',
        inputSchema: { type: 'object', properties: { scope: SCOPE_SCHEMA } },
        readOnly: true,
        async prepare(input) {
            return { title: `Read ${input.scope ?? 'all'} memory` };
        },
        async invoke(input) {
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
            'text (one entry per line) to consolidate duplicates and drop outdated ones. Scope global is about the user, scope project about this workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['remember', 'replace', 'forget', 'rewrite'] },
                scope: SCOPE_SCHEMA,
                text: { type: 'string', description: 'remember/replace: the fact. rewrite: all entries, one per line.' },
                match: { type: 'string', description: 'replace/forget: text identifying the entries to change.' }
            },
            required: ['action', 'scope']
        },
        // Memory persists into future prompts, so changes need the user's approval (shown as a diff).
        readOnly: false,
        async prepare(input) {
            const scope = parseScope(input.scope);
            const plan = await memory.plan(scope, toChange(input));
            const exists = await fs.access(memory.file(scope)).then(() => true, () => false);
            return {
                title: plan.summary.split('\n')[0],
                detail: input.action === 'rewrite' ? undefined : (input.text ?? input.match)?.trim(),
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
        default:
            throw new ToolInputError('"action" must be remember, replace, forget or rewrite.');
    }
}

function parseScope(value: unknown): MemoryScope {
    if (value === 'global' || value === 'project') {
        return value;
    }
    throw new ToolInputError('"scope" must be "global" or "project".');
}
