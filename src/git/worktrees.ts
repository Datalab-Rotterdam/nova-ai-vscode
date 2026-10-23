import * as path from 'node:path';
import { slugify } from '../storage/NovaHome';
import { currentBranch, git, gitOk } from './git';

/** A background agent's own branch and checkout, next to the user's. */
export interface AgentWorktree {
    /** The user's repository. */
    repo: string;
    /** The worktree folder (in ~/.nova-ai/projects/<key>/worktrees). */
    path: string;
    branch: string;
    /** The commit the branch started from. */
    base: string;
}

/** A new branch `nova/<name>-<id>` from HEAD, checked out in `<dir>/<id>`. */
export async function createWorktree(repo: string, dir: string, name: string, id: string): Promise<AgentWorktree> {
    const short = id.slice(0, 6);
    const branch = `nova/${slugify(name).replace(/\./g, '-') || 'agent'}-${short}`;
    const folder = path.join(dir, short);
    const base = (await gitOk(['rev-parse', 'HEAD'], repo)).trim();
    await gitOk(['worktree', 'add', '-b', branch, folder, base], repo);
    return { repo, path: folder, branch, base };
}

/** Commits everything the agent changed; false when it changed nothing. */
export async function commitWorktree(worktree: AgentWorktree, message: string): Promise<boolean> {
    await gitOk(['add', '-A'], worktree.path);
    if (!(await gitOk(['status', '--porcelain'], worktree.path)).trim()) {
        return false;
    }
    await gitOk(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-F', '-'], worktree.path, { input: message });
    return true;
}

export interface ChangedFile {
    status: 'A' | 'M' | 'D';
    path: string;
}

/** What the branch changed since it started (committed and not). */
export async function changedFiles(worktree: AgentWorktree): Promise<ChangedFile[]> {
    await gitOk(['add', '-A', '--intent-to-add'], worktree.path);
    const output = await gitOk(['diff', '--name-status', '--no-renames', worktree.base], worktree.path);
    return output.trim().split('\n').filter(Boolean).map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: status === 'A' || status === 'D' ? status : 'M', path: rest.join('\t') };
    });
}

/** A file as it was when the branch started; empty for files the agent added. */
export async function baseContent(worktree: AgentWorktree, file: string): Promise<string> {
    const result = await git(['show', `${worktree.base}:${file}`], worktree.repo);
    return result.code === 0 ? result.stdout : '';
}

/**
 * Merges the agent's branch into the user's current branch. Refused when the user's tree has
 * uncommitted changes; a conflicting merge is aborted, so the repository is as before.
 */
export async function mergeWorktree(worktree: AgentWorktree): Promise<{ ok: true; into: string } | { ok: false; reason: string }> {
    const into = await currentBranch(worktree.repo) ?? 'HEAD';
    if ((await gitOk(['status', '--porcelain', '--untracked-files=no'], worktree.repo)).trim()) {
        return { ok: false, reason: `Your working tree has uncommitted changes. Commit or stash them, then merge ${worktree.branch} again.` };
    }
    const result = await git(['merge', '--no-ff', '--no-edit', worktree.branch], worktree.repo);
    if (result.code !== 0) {
        await git(['merge', '--abort'], worktree.repo);
        return { ok: false, reason: `The merge into ${into} has conflicts, so it was undone. Merge ${worktree.branch} yourself to resolve them.\n${(result.stdout + result.stderr).trim()}` };
    }
    return { ok: true, into };
}

/** Removes the worktree and its branch. */
export async function removeWorktree(worktree: AgentWorktree): Promise<void> {
    await git(['worktree', 'remove', '--force', worktree.path], worktree.repo);
    await git(['branch', '-D', worktree.branch], worktree.repo);
    await git(['worktree', 'prune'], worktree.repo);
}
