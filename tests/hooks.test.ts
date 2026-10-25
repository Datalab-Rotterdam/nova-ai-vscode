import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CancellationTokenSource } from 'vscode';
import { runShell } from '../src/agent/tools/terminalTool';
import { addHook, listHooks, removeHook, scriptCommand } from '../src/hooks/config';
import { HookService, matchingCommands } from '../src/hooks/HookService';
import { PermissionService } from '../src/permissions/PermissionService';

let dir: string;
const token = () => new CancellationTokenSource().token;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nova-hooks-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** A hook command running a small Node script that reads the event from stdin. */
function nodeHook(name: string, body: string): string {
    const file = path.join(dir, `${name}.cjs`);
    writeFileSync(file, `let input = ''; process.stdin.on('data', (c) => input += c); process.stdin.on('end', () => { const event = JSON.parse(input); ${body} });`);
    return `"${process.execPath}" "${file}"`;
}

function service(hooks: Record<string, unknown[]>): HookService {
    return new HookService(async () => hooks, () => dir);
}

describe('runShell', () => {
    it('writes stdin and keeps stdout and stderr apart', async () => {
        const result = await runShell(`"${process.execPath}" -e "process.stdin.pipe(process.stdout); console.error('err')"`, dir, 5_000, token(), { stdin: 'hello' });
        expect(result).toMatchObject({ exitCode: 0, stdout: 'hello', stderr: 'err' });
    });
});

describe('hooks', () => {
    it('matches tools by regex over Nova\'s name or Claude Code\'s', () => {
        const config = { PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] },
            { matcher: 'edit_file|create_file', hooks: [{ type: 'command', command: 'b', timeout: 5 }] },
            { matcher: 'mcp__github__.*', hooks: [{ type: 'command', command: 'c' }] },
            { hooks: [{ type: 'command', command: 'd' }] }
        ] };
        expect(matchingCommands(config, 'PreToolUse', 'run_command').map((hook) => hook.command)).toEqual(['a', 'd']);
        expect(matchingCommands(config, 'PreToolUse', 'create_file')).toEqual([{ command: 'b', timeout: 5 }, { command: 'd', timeout: 60 }]);
        expect(matchingCommands(config, 'PreToolUse', 'mcp__github__create_issue').map((hook) => hook.command)).toEqual(['c', 'd']);
        expect(matchingCommands(config, 'PreToolUse', 'mcp__githubx__create_issue').map((hook) => hook.command)).toEqual(['d']);
    });

    it('blocks on exit code 2 with stderr as the reason, and passes the event with an absolute file_path', async () => {
        const hook = nodeHook('guard', `if (event.tool_input.file_path.endsWith('.env')) { console.error('no secrets: ' + event.hook_event_name); process.exit(2); }`);
        const hooks = service({ PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: hook }] }] });

        expect(await hooks.run('PreToolUse', { tool_name: 'read_file', tool_input: { path: '.env' } }, token()))
            .toEqual({ block: 'no secrets: PreToolUse', allow: false, warnings: [] });
        expect((await hooks.run('PreToolUse', { tool_name: 'read_file', tool_input: { path: 'a.ts' } }, token())).block).toBeUndefined();
    });

    it('reads JSON decisions and context, and turns other failures into warnings', async () => {
        const approve = nodeHook('approve', `console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }))`);
        const deny = nodeHook('deny', `console.log(JSON.stringify({ decision: 'block', reason: 'not now' }))`);
        const context = nodeHook('context', `console.log('branch: main')`);
        const broken = nodeHook('broken', `console.error('oops'); process.exit(1)`);

        expect((await service({ PreToolUse: [{ hooks: [{ command: approve }] }] }).run('PreToolUse', { tool_name: 'run_command', tool_input: {} }, token())).allow).toBe(true);
        expect((await service({ Stop: [{ hooks: [{ command: deny }, { command: approve }] }] }).run('Stop', {}, token())))
            .toMatchObject({ block: 'not now', allow: false });
        expect((await service({ UserPromptSubmit: [{ hooks: [{ command: context }] }] }).run('UserPromptSubmit', { prompt: 'hi' }, token())).context).toBe('branch: main');
        expect((await service({ Stop: [{ hooks: [{ command: broken }] }] }).run('Stop', {}, token())).warnings[0]).toContain('oops');
    });

    it('times out a slow hook as a warning', async () => {
        const slow = nodeHook('slow', `setTimeout(() => undefined, 10_000)`);
        const outcome = await service({ Stop: [{ hooks: [{ command: slow, timeout: 0.3 }] }] }).run('Stop', {}, token());
        expect(outcome.warnings[0]).toContain('timed out');
    }, 10_000);

    it('reads hooks from the settings files, and the workspace\'s only when trusted', async () => {
        const user = path.join(dir, 'user.json');
        writeFileSync(user, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'user' }] }] } }));
        const workspace = path.join(dir, 'ws');
        mkdirSync(path.join(workspace, '.nova-ai'), { recursive: true });
        writeFileSync(path.join(workspace, '.nova-ai', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'team' }] }] } }));

        let trusted = false;
        const permissions = new PermissionService(user, () => workspace, () => trusted);
        expect(matchingCommands(await permissions.hooks(), 'Stop').map((hook) => hook.command)).toEqual(['user']);
        trusted = true;
        expect(matchingCommands(await permissions.hooks(), 'Stop').map((hook) => hook.command)).toEqual(['user', 'team']);
    });
});

describe('hooks config', () => {
    it('adds hooks to the group with the same matcher and removes them again', () => {
        const settings: Record<string, unknown> = { permissions: { allow: ['read_file'] } };
        addHook(settings, 'PreToolUse', 'run_command', 'a.sh');
        addHook(settings, 'PreToolUse', 'run_command', 'b.sh');
        addHook(settings, 'PreToolUse', undefined, 'c.sh');
        addHook(settings, 'SubagentStop', undefined, 'd.sh');
        expect(settings.hooks).toEqual({
            PreToolUse: [
                { matcher: 'run_command', hooks: [{ type: 'command', command: 'a.sh' }, { type: 'command', command: 'b.sh' }] },
                { hooks: [{ type: 'command', command: 'c.sh' }] }
            ],
            SubagentStop: [{ hooks: [{ type: 'command', command: 'd.sh' }] }]
        });
        expect(listHooks(settings).map((hook) => [hook.event, hook.matcher, hook.command, hook.group, hook.index])).toEqual([
            ['PreToolUse', 'run_command', 'a.sh', 0, 0],
            ['PreToolUse', 'run_command', 'b.sh', 0, 1],
            ['PreToolUse', undefined, 'c.sh', 1, 0],
            ['SubagentStop', undefined, 'd.sh', 0, 0]
        ]);
        // The new events run like the others; matchers only apply to tool events.
        expect(matchingCommands(settings.hooks as Record<string, unknown[]>, 'SubagentStop')).toEqual([{ command: 'd.sh', timeout: 60 }]);

        removeHook(settings, 'PreToolUse', 1, 0);
        removeHook(settings, 'SubagentStop', 0, 0);
        removeHook(settings, 'PreToolUse', 0, 0);
        expect(settings.hooks).toEqual({ PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'b.sh' }] }] });
        removeHook(settings, 'PreToolUse', 0, 0);
        expect(settings).toEqual({ permissions: { allow: ['read_file'] } });
        expect(() => removeHook(settings, 'PreToolUse', 0, 0)).toThrow();
    });

    it('runs a script with its interpreter, relative to the workspace', () => {
        const root = path.join(dir, 'repo');
        expect(scriptCommand(path.join(root, 'hooks', 'check.sh'), root, 'darwin')).toBe('bash hooks/check.sh');
        expect(scriptCommand(path.join(root, 'check.py'), root, 'darwin')).toBe('python3 check.py');
        expect(scriptCommand(path.join(root, 'tools', 'guard'), root, 'darwin')).toBe('./tools/guard');
        expect(scriptCommand(path.join(root, 'my hooks', 'a.js'), root, 'darwin')).toBe('node "my hooks/a.js"');
        expect(scriptCommand('/elsewhere/guard', root, 'darwin')).toBe('/elsewhere/guard');
    });

    it('lists only command hooks', () => {
        expect(listHooks({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'x' }, { command: 'ok.sh', timeout: 5 }] }], Bad: 'x' } }))
            .toEqual([{ event: 'Stop', command: 'ok.sh', timeout: 5, group: 0, index: 1 }]);
    });
});
