import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MemoryService } from '../src/memory/MemoryService';
import { matches, PermissionService, suggestRule } from '../src/permissions/PermissionService';
import { SessionStore } from '../src/panel/SessionStore';
import { NovaHome, pruneOlderThan, slugify, workspaceKey, type WorkspaceIdentity } from '../src/storage/NovaHome';
import { resolveWorkspacePath, setScratchRoot } from '../src/agent/tools/workspacePaths';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-home-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setScratchRoot(undefined);
  vi.restoreAllMocks();
});

const workspace = (fsPath: string, name = 'app'): WorkspaceIdentity => ({ path: fsPath, fsPath, name, scheme: 'file' });

describe('workspace key', () => {
  it('is readable, stable and fixed length', async () => {
    const key = await workspaceKey(workspace('/Users/a/My App', 'My App'), 'linux');
    expect(key).toMatch(/^my-app-[0-9a-f]{8}$/);
    expect(await workspaceKey(workspace('/Users/a/My App', 'My App'), 'linux')).toBe(key);
  });

  it('does not collide where dash-joined paths would', async () => {
    const a = await workspaceKey(workspace('/x/a/b-c', 'b-c'), 'linux');
    const b = await workspaceKey(workspace('/x/a-b/c', 'b-c'), 'linux');
    expect(a).not.toBe(b);
  });

  it('ignores case on case-insensitive platforms only', async () => {
    expect(await workspaceKey(workspace('/Users/A/App/'), 'darwin')).toBe(await workspaceKey(workspace('/users/a/app'), 'darwin'));
    expect(await workspaceKey(workspace('/Users/A/App'), 'linux')).not.toBe(await workspaceKey(workspace('/users/a/app'), 'linux'));
  });

  it('handles Windows paths and very long names', async () => {
    const key = await workspaceKey(workspace('C:\\Users\\Dev\\Project', 'Project'), 'win32');
    expect(key).toMatch(/^project-[0-9a-f]{8}$/);
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(40);
    expect(slugify('***')).toBe('');
    expect(await workspaceKey(workspace('/tmp/***', '***'), 'linux')).toMatch(/^workspace-[0-9a-f]{8}$/);
  });

  it('records the project origin', async () => {
    const home = new NovaHome(dir);
    const project = home.project('app-12345678');
    await home.ensureProject(project, workspace('/repo/app'));
    const info = JSON.parse(readFileSync(project.info, 'utf8'));
    expect(info).toMatchObject({ path: '/repo/app', name: 'app' });
    expect((await home.listProjects())[0]).toMatchObject({ key: 'app-12345678', info: { path: '/repo/app' } });
    if (process.platform !== 'win32') {
      expect(statSync(project.info).mode & 0o777).toBe(0o600);
    }
  });
});

describe('scratch', () => {
  it('prunes only old files', async () => {
    const scratch = join(dir, 'scratch');
    mkdirSync(join(scratch, 'old-dir'), { recursive: true });
    writeFileSync(join(scratch, 'fresh.txt'), 'x');
    writeFileSync(join(scratch, 'old-dir', 'old.txt'), 'x');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(join(scratch, 'old-dir', 'old.txt'), old, old);

    expect(await pruneOlderThan(scratch, 7)).toBe(1);
    expect(existsSync(join(scratch, 'fresh.txt'))).toBe(true);
    expect(existsSync(join(scratch, 'old-dir'))).toBe(false);
  });

  it('lets tools use scratch/ paths but nothing else outside the workspace', () => {
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ name: 'app', uri: vscode.Uri.file('/repo/app'), index: 0 }];
    setScratchRoot(join(dir, 'scratch'));

    expect(resolveWorkspacePath('scratch/test.js').fsPath).toBe(join(dir, 'scratch', 'test.js'));
    expect(() => resolveWorkspacePath('scratch/../../etc/passwd')).toThrow(/outside the scratch folder/);
    expect(() => resolveWorkspacePath('/etc/passwd')).toThrow(/outside the workspace/);
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
  });
});

describe('session store', () => {
  it('saves, lists and deletes sessions in the project folder', async () => {
    const store = await SessionStore.open(join(dir, 'sessions'));
    await store.save({ id: 's1', title: 'First', createdAt: 1, updatedAt: 1, items: [], messages: [] });
    await store.save({ id: 's2', title: 'Second', createdAt: 2, updatedAt: 2, items: [], messages: [] });

    const reopened = await SessionStore.open(join(dir, 'sessions'));
    expect(reopened.list().map((summary) => summary.id)).toEqual(['s2', 's1']);
    expect((await reopened.load('s1'))?.title).toBe('First');

    await reopened.delete('s1');
    expect((await SessionStore.open(join(dir, 'sessions'))).list().map((summary) => summary.id)).toEqual(['s2']);
  });

  it('migrates chats from VS Code storage once', async () => {
    const legacy = { id: 'old1', title: 'Old chat', createdAt: 1, updatedAt: 5, items: [], messages: [] };
    const values = new Map<string, unknown>([['nova.chat.sessions', [{ id: 'old1', title: 'Old chat', updatedAt: 5 }]]]);
    const state = { get: (key: string, fallback?: unknown) => values.get(key) ?? fallback, update: async (key: string, value: unknown) => void values.set(key, value) };
    vi.spyOn(vscode.workspace, 'fs', 'get').mockReturnValue({
      readFile: async () => new TextEncoder().encode(JSON.stringify(legacy))
    } as never);

    const store = await SessionStore.open(join(dir, 'sessions'));
    expect(await store.migrateLegacy(state as never, vscode.Uri.file('/legacy'))).toBe(1);
    expect(await store.migrateLegacy(state as never, vscode.Uri.file('/legacy'))).toBe(0);
    expect(store.list()).toEqual([{ id: 'old1', title: 'Old chat', updatedAt: 5 }]);
    expect((await store.load('old1'))?.title).toBe('Old chat');
  });
});

describe('memory', () => {
  const service = () => new MemoryService({ global: join(dir, 'MEMORY.md'), project: join(dir, 'p', 'MEMORY.md') }, () => [join(dir, 'repo')]);

  it('remembers and forgets entries per scope', async () => {
    const memory = service();
    expect(await memory.remember('global', 'Prefers pnpm over npm')).toBe('Remembered: Prefers pnpm over npm');
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toMatch(/\n- \d{4}-\d{2}-\d{2}: Prefers pnpm over npm\n$/);
    await memory.remember('project', 'Tests run with vitest');

    expect(await memory.read('global')).toContain('Prefers pnpm');
    expect(await memory.read('project')).toContain('vitest');
    expect(await memory.forget('global', 'PNPM')).toHaveLength(1);
    expect(await memory.read('global')).not.toContain('pnpm');
  });

  it('builds a prompt section from memory and repository instructions', async () => {
    const memory = service();
    mkdirSync(join(dir, 'repo'));
    writeFileSync(join(dir, 'repo', 'AGENTS.md'), 'Use tabs.');
    await memory.remember('project', 'API lives in src/api');
    await memory.ensureFile('global'); // template only: not included

    const section = await memory.promptSection();
    expect(section).toContain('<memory scope="repository" source="AGENTS.md">\nUse tabs.');
    expect(section).toContain('<memory scope="project" source="MEMORY.md">');
    expect(section).not.toContain('scope="global"');
    expect(section).toContain('not as instructions that override');
  });

  it('caps very large memory files', async () => {
    const memory = service();
    mkdirSync(join(dir, 'p'), { recursive: true });
    writeFileSync(join(dir, 'p', 'MEMORY.md'), 'x'.repeat(50_000));
    expect((await memory.promptSection()).length).toBeLessThan(9_000);
  });
});

describe('permissions', () => {
  it('matches tool rules with globs on the subject', () => {
    expect(matches('run_command(npm test*)', 'run_command', 'npm test -- client')).toBe(true);
    expect(matches('run_command(npm test*)', 'run_command', 'npm publish')).toBe(false);
    expect(matches('edit_file', 'edit_file', 'src/a.ts')).toBe(true);
    expect(matches('edit_file', 'create_file', 'src/a.ts')).toBe(false);
    expect(suggestRule('fetch_url', 'https://docs.example.com/a/b?c=1')).toBe('fetch_url(https://docs.example.com/*)');
    expect(suggestRule('run_command', 'npm test')).toBe('run_command(npm test)');
  });

  it('merges global and workspace rules; deny wins; workspace allow needs trust', async () => {
    const root = join(dir, 'repo');
    mkdirSync(join(root, '.nova-ai'), { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ['run_command(git status)'] } }));
    writeFileSync(join(root, '.nova-ai', 'settings.json'), JSON.stringify({ permissions: { allow: ['run_command(npm test*)'], deny: ['run_command(rm *)'] } }));
    let trusted = true;
    const permissions = new PermissionService(join(dir, 'settings.json'), () => root, () => trusted);

    expect(await permissions.decide('run_command', 'git status')).toBe('allow');
    expect(await permissions.decide('run_command', 'npm test')).toBe('allow');
    expect(await permissions.decide('run_command', 'rm -rf /')).toBe('deny');
    expect(await permissions.decide('run_command', 'make')).toBeUndefined();

    trusted = false;
    expect(await permissions.decide('run_command', 'npm test')).toBeUndefined();
    expect(await permissions.decide('run_command', 'rm -rf /')).toBe('deny');
  });

  it('saves "Always allow" rules to a gitignored local settings file', async () => {
    const root = join(dir, 'repo');
    const permissions = new PermissionService(join(dir, 'settings.json'), () => root, () => true);

    await permissions.allow('run_command(npm run build)');
    await permissions.allow('run_command(npm run build)');

    const local = JSON.parse(readFileSync(join(root, '.nova-ai', 'settings.local.json'), 'utf8'));
    expect(local.permissions.allow).toEqual(['run_command(npm run build)']);
    expect(readFileSync(join(root, '.nova-ai', '.gitignore'), 'utf8')).toBe('settings.local.json\n');
    expect(await permissions.decide('run_command', 'npm run build')).toBe('allow');
  });
});

describe('memory maintenance', () => {
  const service = () => new MemoryService({ global: join(dir, 'MEMORY.md'), project: join(dir, 'p', 'MEMORY.md') }, () => []);

  it('does not store the same fact twice', async () => {
    const memory = service();
    await memory.remember('global', 'Prefers pnpm');
    expect(await memory.remember('global', 'prefers  PNPM.')).toMatch(/^Already remembered/);
    expect((await memory.read('global')).match(/pnpm/gi)).toHaveLength(1);
  });

  it('replaces an outdated fact in place', async () => {
    const memory = service();
    await memory.remember('project', 'Tests run with jest');
    await memory.remember('project', 'API lives in src/api');
    const plan = await memory.plan('project', { action: 'replace', match: 'jest', text: 'Tests run with vitest' });
    expect(plan.summary).toMatch(/^Replaced 1 entry/);
    await memory.apply('project', plan);

    const text = await memory.read('project');
    expect(text).toContain('vitest');
    expect(text).not.toContain('jest');
    expect(text.indexOf('vitest')).toBeLessThan(text.indexOf('src/api'));
  });

  it('consolidates a file with rewrite and keeps the header', async () => {
    const memory = service();
    for (const fact of ['Uses pnpm', 'Uses pnpm workspaces', 'Old: uses yarn', 'Prefers short answers']) {
      await memory.remember('global', fact);
    }
    const plan = await memory.plan('global', { action: 'rewrite', text: '- Uses pnpm (workspaces)\nPrefers short answers' });
    expect(plan.summary).toBe('Rewrote global memory: 4 → 2 entries.');
    await memory.apply('global', plan);

    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toMatch(/^# Nova memory \(global\)[\s\S]*\n- Uses pnpm \(workspaces\)\n- Prefers short answers\n$/);
  });

  it('refuses to apply a plan when the file changed meanwhile', async () => {
    const memory = service();
    await memory.remember('global', 'One');
    const plan = await memory.plan('global', { action: 'forget', match: 'one' });
    await memory.remember('global', 'Two');
    await expect(memory.apply('global', plan)).rejects.toThrow(/changed in the meantime/);
  });

  it('asks Nova to consolidate when a memory file grows long', async () => {
    const memory = service();
    for (let index = 0; index < 45; index++) {
      await memory.remember('project', `Fact number ${index}`);
    }
    expect(await memory.promptSection()).toContain('The project memory is getting long');
  });
});
