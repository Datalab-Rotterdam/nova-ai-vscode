import { execFile } from 'node:child_process';

/** Longest git output kept, so a huge diff cannot fill memory. */
const MAX_BUFFER = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface GitOptions {
    /** Written to stdin, e.g. a commit message for `git commit -F -`. */
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

/**
 * Runs git (or gh) with an argument list, never through a shell, so messages and branch
 * names need no quoting. The git CLI rather than VS Code's git extension: that one can be
 * turned off, and it knows nothing of worktrees.
 */
export function run(program: 'git' | 'gh', args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult> {
    return new Promise((resolve) => {
        const child = execFile(program, args, {
            cwd,
            maxBuffer: MAX_BUFFER,
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal: options.signal,
            // Never wait for a password or an editor nobody can see.
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GH_PROMPT_DISABLED: '1' }
        }, (error, stdout, stderr) => {
            const code = error ? typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1 : 0;
            resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() || (error && code === 1 && !stdout ? error.message : '') });
        });
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(options.input);
    });
}

export function git(args: string[], cwd: string, options?: GitOptions): Promise<GitResult> {
    return run('git', args, cwd, options);
}

/** Like {@link git}, but throws with git's message when it fails. */
export async function gitOk(args: string[], cwd: string, options?: GitOptions): Promise<string> {
    const result = await git(args, cwd, options);
    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout).trim() || `git ${args[0]} failed.`);
    }
    return result.stdout;
}

/** The repository's top folder, or undefined outside a repository (or without git). */
export async function repoRoot(cwd: string): Promise<string | undefined> {
    const result = await git(['rev-parse', '--show-toplevel'], cwd);
    return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
    const result = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
    return result.code === 0 ? result.stdout.trim() : undefined;
}

/** The branch work is based on: origin's default branch, else a local main or master. */
export async function defaultBase(cwd: string): Promise<string | undefined> {
    const remoteHead = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd);
    if (remoteHead.code === 0 && remoteHead.stdout.trim()) {
        return remoteHead.stdout.trim();
    }
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
        if ((await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd)).code === 0) {
            return candidate;
        }
    }
    return undefined;
}

export async function hasGh(cwd: string): Promise<boolean> {
    return (await run('gh', ['--version'], cwd, { timeoutMs: 5_000 })).code === 0;
}

/** The page to open a pull/merge request for a branch on GitHub, GitLab or Bitbucket; undefined for other hosts. */
export function compareUrl(remoteUrl: string, branch: string, base?: string): string | undefined {
    const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
    if (!match) {
        return undefined;
    }
    const [, host, repo] = match;
    const target = base?.replace(/^origin\//, '');
    if (host.includes('gitlab')) {
        return `https://${host}/${repo}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}${target ? `&merge_request[target_branch]=${encodeURIComponent(target)}` : ''}`;
    }
    if (host.includes('bitbucket')) {
        return `https://${host}/${repo}/pull-requests/new?source=${encodeURIComponent(branch)}${target ? `&dest=${encodeURIComponent(target)}` : ''}`;
    }
    if (host.includes('github')) {
        return `https://${host}/${repo}/compare/${target ? `${encodeURIComponent(target)}...` : ''}${encodeURIComponent(branch)}?expand=1`;
    }
    return undefined;
}
