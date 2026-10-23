import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { compareUrl, defaultBase, gitOk } from '../src/git/git';
import { cleanMessage, commitChanges, openPullRequest, reviewRequest, type GitCommandHost } from '../src/git/gitCommands';

let dir: string;
let repo: string;
const token = () => new vscode.CancellationTokenSource().token;

function sh(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repository with one commit on main, and a bare "origin" it tracks. */
function makeRepo(): void {
    const origin = path.join(dir, 'origin.git');
    repo = path.join(dir, 'repo');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    sh(repo, 'config', 'user.email', 'test@example.com');
    sh(repo, 'config', 'user.name', 'Test');
    sh(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'feat: first');
    sh(repo, 'remote', 'add', 'origin', origin);
    sh(repo, 'push', '-q', '-u', 'origin', 'main');
    sh(repo, 'remote', 'set-head', 'origin', 'main');
}

function host(answer = ''): GitCommandHost & { notices: string[]; prompts: string[] } {
    const notices: string[] = [];
    const prompts: string[] = [];
    return {
        notices,
        prompts,
        cwd: () => repo,
        complete: async (prompt) => {
            prompts.push(prompt);
            return answer;
        },
        notice: (_tone, text) => void notices.push(text),
        openExternal: async () => undefined
    };
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nova-git-'));
    makeRepo();
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
});

describe('git helpers', () => {
    it('finds the base branch from origin', async () => {
        expect(await defaultBase(repo)).toBe('origin/main');
    });

    it('builds the page for a new pull or merge request from https and ssh remotes', () => {
        expect(compareUrl('git@github.com:Datalab-Rotterdam/nova-ai-vscode.git', 'feat/x', 'origin/main'))
            .toBe('https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/main...feat%2Fx?expand=1');
        expect(compareUrl('https://gitlab.com/group/sub/project.git', 'fix', 'origin/main'))
            .toBe('https://gitlab.com/group/sub/project/-/merge_requests/new?merge_request[source_branch]=fix&merge_request[target_branch]=main');
        expect(compareUrl('ssh://git@bitbucket.org/team/repo.git', 'b')).toBe('https://bitbucket.org/team/repo/pull-requests/new?source=b');
        expect(compareUrl('/local/path/repo.git', 'b')).toBeUndefined();
    });

    it('cleans a model answer down to the message', () => {
        expect(cleanMessage('<think>hmm</think>\n```text\nfix: a thing\n\nbody\n```')).toBe('fix: a thing\n\nbody');
        expect(cleanMessage('"feat: quoted"')).toBe('feat: quoted');
    });
});

describe('/commit', () => {
    it('stages everything after asking, commits the confirmed message and reports the hash', async () => {
        writeFileSync(path.join(repo, 'a.txt'), 'two\n');
        const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Stage All' as never);
        vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Commit' as never);
        const chat = host('```\nfix: change a\n\nWhy it changed.\n```');

        await commitChanges(chat, 'typo', token());

        expect(warn).toHaveBeenCalledOnce();
        expect(chat.prompts[0]).toContain('feat: first');
        expect(chat.prompts[0]).toContain('+two');
        expect(chat.prompts[0]).toContain("author's note on this change: typo");
        expect(sh(repo, 'log', '-1', '--format=%B').trim()).toBe('fix: change a\n\nWhy it changed.');
        expect(chat.notices[0]).toMatch(/^Committed [0-9a-f]+: fix: change a$/);
    });

    it('commits nothing when the user cancels, and keeps an edited subject', async () => {
        writeFileSync(path.join(repo, 'a.txt'), 'two\n');
        sh(repo, 'add', '-A');
        const confirm = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValueOnce(undefined as never);
        await commitChanges(host('fix: x'), '', token());
        expect(sh(repo, 'log', '--format=%s')).toBe('feat: first\n');

        confirm.mockResolvedValueOnce('Edit…' as never);
        vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('fix: better subject');
        await commitChanges(host('fix: x\n\nbody'), '', token());
        expect(sh(repo, 'log', '-1', '--format=%B').trim()).toBe('fix: better subject\n\nbody');
    });

    it('says so when there is nothing to commit', async () => {
        const chat = host();
        await commitChanges(chat, '', token());
        expect(chat.notices).toEqual(['Nothing to commit: the working tree is clean.']);
    });
});

describe('/review', () => {
    it('attaches commits, uncommitted changes and new files against the base', async () => {
        sh(repo, 'switch', '-q', '-c', 'feat/b');
        writeFileSync(path.join(repo, 'a.txt'), 'committed\n');
        sh(repo, 'commit', '-q', '-am', 'feat: on branch');
        writeFileSync(path.join(repo, 'a.txt'), 'uncommitted\n');
        writeFileSync(path.join(repo, 'new.txt'), 'new\n');

        const request = await reviewRequest(host(), '');

        expect(request?.prompt).toContain('`feat/b` against `origin/main`');
        const content = request?.attachments[0].content ?? '';
        expect(content).toContain('feat: on branch');
        expect(content).toContain('new.txt');
        expect(content).toContain('+uncommitted');
    });

    it('reports an unknown base and an empty diff', async () => {
        const chat = host();
        expect(await reviewRequest(chat, 'nope')).toBeUndefined();
        expect(await reviewRequest(chat, '')).toBeUndefined();
        expect(chat.notices).toEqual(['"nope" is not a branch or commit of this repository.', 'No changes against origin/main.']);
    });
});

describe('/pr', () => {
    it('moves work off the default branch to a new branch and pushes it', async () => {
        writeFileSync(path.join(repo, 'a.txt'), 'two\n');
        sh(repo, 'commit', '-q', '-am', 'feat: second');
        vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('feat/second');
        // Without gh on PATH, and with a remote no host page exists for.
        const pathBefore = process.env.PATH;
        process.env.PATH = '/usr/bin:/bin';
        const chat = host();
        try {
            await openPullRequest(chat, '', token());
        } finally {
            process.env.PATH = pathBefore;
        }

        expect(sh(repo, 'branch', '--show-current').trim()).toBe('feat/second');
        expect(await gitOk(['ls-remote', '--heads', 'origin', 'feat/second'], repo)).toContain('refs/heads/feat/second');
        expect(chat.notices[0]).toContain('Pushed feat/second');
    });
});
