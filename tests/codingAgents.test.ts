import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { displayPath, resolveWorkspacePath, toolRoot, withToolRoot, workspaceFolders } from '../src/agent/tools/workspacePaths';
import { baseContent, changedFiles, commitWorktree, createWorktree, mergeWorktree, removeWorktree } from '../src/git/worktrees';

let dir: string;
let repo: string;

function sh(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nova-agents-'));
    repo = path.join(dir, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    sh(repo, 'config', 'user.email', 'test@example.com');
    sh(repo, 'config', 'user.name', 'Test');
    sh(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'first');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('tools rooted in a worktree', () => {
    it('resolve paths inside the worktree only, also across awaits', async () => {
        (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ name: 'repo', uri: vscode.Uri.file(repo), index: 0 }];
        const worktree = path.join(dir, 'wt');

        await withToolRoot(worktree, async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            expect(toolRoot()).toBe(worktree);
            expect(workspaceFolders()[0].uri.fsPath).toBe(worktree);
            expect(resolveWorkspacePath('src/a.ts').fsPath).toBe(path.join(worktree, 'src', 'a.ts'));
            expect(displayPath(vscode.Uri.file(path.join(worktree, 'src', 'a.ts')))).toBe('src/a.ts');
            expect(() => resolveWorkspacePath(path.join(repo, 'a.txt'))).toThrow(/outside the workspace/);
            expect(() => resolveWorkspacePath('../repo/a.txt')).toThrow(/outside the workspace/);
        });
        expect(toolRoot()).toBeUndefined();
        expect(resolveWorkspacePath('a.txt').fsPath).toBe(path.join(repo, 'a.txt'));
    });
});

describe('agent worktrees', () => {
    it('branch off HEAD, commit the agent\'s work and list what changed against the base', async () => {
        const worktree = await createWorktree(repo, path.join(dir, 'worktrees'), 'Fix the login.', 'abcdef123456');
        expect(worktree.branch).toBe('nova/fix-the-login-abcdef');
        expect(readFileSync(path.join(worktree.path, 'a.txt'), 'utf8')).toBe('one\n');

        writeFileSync(path.join(worktree.path, 'a.txt'), 'two\n');
        writeFileSync(path.join(worktree.path, 'b.txt'), 'new\n');
        expect(await commitWorktree(worktree, 'Fix the login')).toBe(true);
        expect(await commitWorktree(worktree, 'nothing left')).toBe(false);

        expect(await changedFiles(worktree)).toEqual([{ status: 'M', path: 'a.txt' }, { status: 'A', path: 'b.txt' }]);
        expect(await baseContent(worktree, 'a.txt')).toBe('one\n');
        expect(await baseContent(worktree, 'b.txt')).toBe('');
        // The user's checkout is untouched.
        expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\n');
    });

    it('merges into the current branch and removes the worktree and branch', async () => {
        const worktree = await createWorktree(repo, path.join(dir, 'worktrees'), 'add b', '111111aaaa');
        writeFileSync(path.join(worktree.path, 'b.txt'), 'new\n');
        await commitWorktree(worktree, 'Add b');

        expect(await mergeWorktree(worktree)).toEqual({ ok: true, into: 'main' });
        expect(readFileSync(path.join(repo, 'b.txt'), 'utf8')).toBe('new\n');
        await removeWorktree(worktree);
        expect(existsSync(worktree.path)).toBe(false);
        expect(sh(repo, 'branch', '--list', worktree.branch)).toBe('');
    });

    it('refuses to merge over uncommitted work and undoes a conflicting merge', async () => {
        const worktree = await createWorktree(repo, path.join(dir, 'worktrees'), 'change a', '222222bbbb');
        writeFileSync(path.join(worktree.path, 'a.txt'), 'agent\n');
        await commitWorktree(worktree, 'Change a');

        writeFileSync(path.join(repo, 'a.txt'), 'user, uncommitted\n');
        expect(await mergeWorktree(worktree)).toMatchObject({ ok: false, reason: expect.stringContaining('uncommitted changes') });

        sh(repo, 'commit', '-q', '-am', 'user change');
        const conflict = await mergeWorktree(worktree);
        expect(conflict).toMatchObject({ ok: false, reason: expect.stringContaining('conflicts, so it was undone') });
        expect(sh(repo, 'status', '--porcelain')).toBe('');
        expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('user, uncommitted\n');
    });
});
