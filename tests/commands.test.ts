import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandCommand, findCommands } from '../src/commands/CommandService';
import { parseSlashCommand, suggestSlashCommands, type SlashCommand } from '../src/panel/slashCommands';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nova-commands-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function write(file: string, content: string): void {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
}

describe('command files', () => {
    it('reads Nova\'s and (when on) Claude\'s folders, names subfolders ns:name, and lets the workspace win', () => {
        write('home/.nova-ai/commands/test.md', '---\ndescription: Global tests\nargument-hint: <file>\nmodel: fast\n---\nTest $ARGUMENTS');
        write('home/.claude/commands/claude-only.md', 'From Claude');
        write('ws/.nova-ai/commands/test.md', '---\ndescription: Project tests\n---\nProject test $1');
        write('ws/.nova-ai/commands/frontend/Lint.md', 'Lint the frontend.');
        const paths = { home: path.join(dir, 'home'), novaHome: path.join(dir, 'home/.nova-ai'), workspaceRoots: [path.join(dir, 'ws')], includeClaude: false };

        expect(findCommands(paths).map((command) => [command.name, command.scope, command.description])).toEqual([
            ['frontend:lint', 'project', 'Lint the frontend.'],
            ['test', 'project', 'Project tests']
        ]);
        expect(findCommands({ ...paths, includeClaude: true }).map((command) => command.name)).toContain('claude-only');
    });

    it('fills in $ARGUMENTS and $1…$9, or adds the arguments at the end', () => {
        expect(expandCommand({ prompt: 'Review $ARGUMENTS carefully' }, 'src/a.ts and b.ts')).toBe('Review src/a.ts and b.ts carefully');
        expect(expandCommand({ prompt: 'Move $1 to $2' }, 'a.ts lib/')).toBe('Move a.ts to lib/');
        expect(expandCommand({ prompt: 'Explain the build.' }, 'briefly')).toBe('Explain the build.\n\nbriefly');
        expect(expandCommand({ prompt: 'Explain the build.' }, '')).toBe('Explain the build.');
    });
});

describe('slash commands with commands from files, skills and MCP', () => {
    const extra: SlashCommand[] = [
        { name: 'frontend:lint', description: 'Lint', source: 'file' },
        { name: 'commit', description: 'A file named like a built-in', source: 'file' },
        { name: 'mcp__everything__simple_prompt', description: 'Prompt', source: 'mcp' }
    ];

    it('parses them with arguments, and built-ins win a name clash', () => {
        expect(parseSlashCommand('/frontend:lint src', extra)).toMatchObject({ command: { name: 'frontend:lint', source: 'file' }, args: 'src' });
        expect(parseSlashCommand('/commit', extra)?.command.source).toBeUndefined();
        expect(parseSlashCommand('/frontend:lint')).toBeUndefined();
    });

    it('suggests them after the built-ins', () => {
        expect(suggestSlashCommands('/mcp', extra).map((command) => command.name)).toEqual(['mcp__everything__simple_prompt']);
        expect(suggestSlashCommands('/', extra).map((command) => command.name).slice(-2)).toEqual(['frontend:lint', 'mcp__everything__simple_prompt']);
    });
});
