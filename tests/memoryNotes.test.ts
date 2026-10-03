import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryTools } from '../src/agent/tools/memoryTools';
import { MemoryService } from '../src/memory/MemoryService';

// Layout from docs/NOVA_HOME.md: <root>/MEMORY.md + <root>/memory/, and the same per project.
let root: string;
let projectDir: string;
const service = () => new MemoryService({ global: join(root, 'MEMORY.md'), project: join(projectDir, 'MEMORY.md') }, () => []);
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* no-op */ } }) };

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nova-notes-'));
    projectDir = join(root, 'projects', 'repo-12345678');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A note exactly as nova-ai-cli writes it. */
const cliNote = '---\nname: release-flow\ndescription: "how releases are cut"\ntype: project\n---\n\nsemantic-release on main';

describe('memory notes (shared with nova-ai-cli)', () => {
    it('keeps notes in memory/ next to each MEMORY.md', () => {
        expect(service().notesDir('global')).toBe(join(root, 'memory'));
        expect(service().notesDir('project')).toBe(join(projectDir, 'memory'));
    });

    it('reads notes written by the CLI and lists them in the prompt', async () => {
        mkdirSync(join(projectDir, 'memory'), { recursive: true });
        writeFileSync(join(projectDir, 'memory', 'release-flow.md'), cliNote);
        const memory = service();
        expect((await memory.notes()).map((note) => [note.name, note.type, note.scope, note.description]))
            .toEqual([['release-flow', 'project', 'project', 'how releases are cut']]);
        expect(await memory.promptSection()).toContain('- release-flow [project/project]: how releases are cut');
        expect((await memory.readNote('release-flow'))?.content).toBe(cliNote);
    });

    it('saves a note in the CLI format with exactly one link line, and deletes both', async () => {
        const memory = service();
        const save = async (description: string) => memory.apply('project', await memory.plan('project', {
            action: 'save_note', name: 'release-flow', description, type: 'project', content: 'semantic-release on main'
        }));
        await save('how releases are cut');
        await save('how releases are cut');
        const notePath = join(projectDir, 'memory', 'release-flow.md');
        expect(readFileSync(notePath, 'utf8')).toBe(cliNote);
        const index = readFileSync(join(projectDir, 'MEMORY.md'), 'utf8');
        expect(index.startsWith('# Nova memory (this project)')).toBe(true);
        expect(index.match(/\(memory\/release-flow\.md\)/g)).toHaveLength(1);
        expect(index).toContain('- [Release flow](memory/release-flow.md) — how releases are cut');
        if (process.platform !== 'win32') {
            expect(statSync(notePath).mode & 0o777).toBe(0o600);
        }

        await memory.apply('project', await memory.plan('project', { action: 'delete_note', name: 'release-flow' }));
        expect(existsSync(notePath)).toBe(false);
        expect(readFileSync(join(projectDir, 'MEMORY.md'), 'utf8')).not.toContain('release-flow');
    });

    it('lets a project note hide a global note of the same name', async () => {
        const memory = service();
        for (const scope of ['global', 'project'] as const) {
            await memory.apply(scope, await memory.plan(scope, {
                action: 'save_note', name: 'style', description: `${scope} style`, type: 'feedback', content: scope
            }));
        }
        expect((await memory.notes()).map((note) => [note.name, note.scope])).toEqual([['style', 'project']]);
    });

    it('refuses invalid notes and changes made in the meantime', async () => {
        const memory = service();
        await expect(memory.plan('project', { action: 'save_note', name: 'Bad Name', description: 'd', type: 'user', content: 'x' }))
            .rejects.toThrow(/kebab-case/);
        const plan = await memory.plan('project', { action: 'save_note', name: 'n', description: 'd', type: 'user', content: 'x' });
        mkdirSync(join(projectDir, 'memory'), { recursive: true });
        writeFileSync(join(projectDir, 'memory', 'n.md'), 'edited by the user');
        await expect(memory.apply('project', plan)).rejects.toThrow(/changed in the meantime/);
        expect(readFileSync(join(projectDir, 'memory', 'n.md'), 'utf8')).toBe('edited by the user');
    });

    it('writes atomically, leaving no temporary files', async () => {
        const memory = service();
        await memory.remember('global', 'User prefers pnpm.');
        expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });
});

describe('memory tools with notes', () => {
    it('shows the note as the approval diff and reads it back by name', async () => {
        const memory = service();
        const [read, write] = createMemoryTools(memory) as unknown as Array<{
            prepare(input: unknown, context: unknown): Promise<{ title: string; edit?: { proposed: string; isNewFile: boolean } }>;
            invoke(input: unknown, context: unknown, preparation: unknown): Promise<string>;
        }>;
        const input = { action: 'save_note', scope: 'project', name: 'build', description: 'how to build', type: 'project', content: 'npm run build' };
        const preparation = await write.prepare(input, { token });
        expect(preparation.edit?.isNewFile).toBe(true);
        expect(preparation.edit?.proposed).toContain('npm run build');
        await write.invoke(input, { token }, preparation);

        expect(await read.invoke({ name: 'build' }, { token }, { title: '' })).toContain('Memory note: build [project/project]');
        await expect(read.invoke({ name: 'missing' }, { token }, { title: '' })).rejects.toThrow(/Unknown memory note/);
    });
});
