import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { Attachment } from '../panel/protocol';
import { compareUrl, currentBranch, defaultBase, git, gitOk, repoRoot, reviewCliFor, run, type ReviewCli } from './git';

/** Most diff text handed to the model; the rest is cut from the middle. */
const MAX_DIFF_CHARS = 60_000;
const PUSH_TIMEOUT_MS = 120_000;

/** What the git slash commands need from the chat. */
export interface GitCommandHost {
    /** The folder the commands work in (the first workspace folder). */
    cwd(): string | undefined;
    /** One answer from the chat's model, without tools. */
    complete(prompt: string, token: vscode.CancellationToken): Promise<string>;
    notice(tone: 'info' | 'warning' | 'error', text: string): void;
    openExternal(url: string): Promise<void>;
}

/** `/commit [hint]`: the model writes the message for the staged changes; the user confirms or edits it. */
export async function commitChanges(host: GitCommandHost, hint: string, token: vscode.CancellationToken): Promise<void> {
    const root = await requireRepo(host);
    if (!root) {
        return;
    }
    if (!(await gitOk(['diff', '--cached', '--name-only'], root)).trim()) {
        const status = await gitOk(['status', '--porcelain'], root);
        if (!status.trim()) {
            host.notice('info', 'Nothing to commit: the working tree is clean.');
            return;
        }
        const choice = await vscode.window.showWarningMessage('Nothing is staged. Stage all changes and commit them?', { modal: true, detail: listFiles(status) }, 'Stage All');
        if (choice !== 'Stage All') {
            return;
        }
        await gitOk(['add', '-A'], root);
    }

    const [stat, diff, log] = await Promise.all([
        gitOk(['diff', '--cached', '--stat'], root),
        gitOk(['diff', '--cached'], root),
        git(['log', '-n', '10', '--format=%s'], root)
    ]);
    const message = cleanMessage(await host.complete([
        'Write a git commit message for the staged changes below.',
        '- Match the style of the recent commits (for example Conventional Commits, if they use it).',
        '- Subject: imperative mood, at most 72 characters. Add a blank line and a short body only when the change needs explaining; wrap it at 72 characters.',
        '- Reply with the commit message only: no quotes, no code fences, no commentary.',
        ...(hint ? [`- The author's note on this change: ${hint}`] : []),
        '',
        `Recent commits:\n${log.stdout.trim() || '(none yet)'}`,
        '',
        `Changed files:\n${stat.trim()}`,
        '',
        `Diff:\n${clip(diff)}`
    ].join('\n'), token));
    if (token.isCancellationRequested) {
        return;
    }
    if (!message) {
        throw new Error('The model wrote no commit message.');
    }

    const final = await confirmText('Commit with this message?', message, 'Commit', 'Commit subject (the rest stays as written)');
    if (!final) {
        host.notice('info', 'Not committed. The changes stay staged.');
        return;
    }
    const result = await git(['commit', '-F', '-'], root, { input: final, timeoutMs: PUSH_TIMEOUT_MS });
    if (result.code !== 0) {
        throw new Error(`git commit failed:\n${(result.stderr || result.stdout).trim()}`);
    }
    const hash = (await gitOk(['rev-parse', '--short', 'HEAD'], root)).trim();
    host.notice('info', `Committed ${hash}: ${final.split('\n')[0]}`);
}

/**
 * `/review [base]`: the changes against the base branch (commits and uncommitted work), as a
 * normal request with the diff attached, so the agent can read the code around them.
 */
export async function reviewRequest(host: GitCommandHost, baseArg: string): Promise<{ prompt: string; attachments: Attachment[] } | undefined> {
    const root = await requireRepo(host);
    if (!root) {
        return undefined;
    }
    const base = baseArg || await defaultBase(root);
    const mergeBase = base ? (await git(['merge-base', base, 'HEAD'], root)).stdout.trim() : '';
    if (baseArg && !mergeBase) {
        host.notice('error', `"${baseArg}" is not a branch or commit of this repository.`);
        return undefined;
    }
    const [diff, commits, untracked] = await Promise.all([
        gitOk(['diff', mergeBase || 'HEAD'], root),
        mergeBase ? gitOk(['log', '--oneline', `${mergeBase}..HEAD`], root) : Promise.resolve(''),
        gitOk(['ls-files', '--others', '--exclude-standard'], root)
    ]);
    if (!diff.trim() && !untracked.trim()) {
        host.notice('info', mergeBase ? `No changes against ${base}.` : 'No uncommitted changes to review.');
        return undefined;
    }
    const branch = await currentBranch(root) ?? 'HEAD';
    const against = mergeBase ? `against \`${base}\`` : '(uncommitted changes)';
    return {
        prompt: `Review my changes on \`${branch}\` ${against}; the diff is attached. Look for bugs, security problems, unhandled edge cases and missing tests, and read the surrounding code where you need it. Do not edit files. Report findings ranked by severity, each with file:line, what is wrong and a suggested fix. If you find nothing worth changing, say so.`,
        attachments: [{
            id: randomUUID(),
            label: 'changes.diff',
            content: [
                ...(commits.trim() ? [`Commits:\n${commits.trim()}`, ''] : []),
                ...(untracked.trim() ? [`New files not yet in git (read them with your tools):\n${untracked.trim()}`, ''] : []),
                clip(diff)
            ].join('\n')
        }]
    };
}

/** `/pr [hint]`: pushes the branch and opens a pull request (gh) or merge request (glab), or the host's page to open one. */
export async function openPullRequest(host: GitCommandHost, hint: string, token: vscode.CancellationToken): Promise<void> {
    const root = await requireRepo(host);
    if (!root) {
        return;
    }
    let branch = await currentBranch(root);
    if (!branch) {
        host.notice('error', 'HEAD is detached. Switch to a branch first.');
        return;
    }
    const base = await defaultBase(root);
    const baseName = base?.replace(/^origin\//, '');
    if (branch === baseName) {
        const name = await vscode.window.showInputBox({
            title: 'Create a branch for the pull request',
            prompt: `You are on ${branch}. Name a new branch for these commits.`,
            validateInput: async (value) => !value.trim() ? 'Enter a branch name.' : (await git(['check-ref-format', '--branch', value.trim()], root)).code ? 'Not a valid branch name.' : undefined
        });
        if (!name) {
            return;
        }
        await gitOk(['switch', '-c', name.trim()], root);
        branch = name.trim();
    }
    if ((await gitOk(['status', '--porcelain', '--untracked-files=no'], root)).trim()) {
        const choice = await vscode.window.showWarningMessage('There are uncommitted changes. They will not be part of the pull request.', { modal: true, detail: 'Use /commit first to include them.' }, 'Continue');
        if (choice !== 'Continue') {
            return;
        }
    }
    const range = base ? `${base}..HEAD` : 'HEAD';
    if (base && (await gitOk(['rev-list', '--count', range], root)).trim() === '0') {
        host.notice('info', `${branch} has no commits that are not on ${base}.`);
        return;
    }

    const push = await git(['push', '-u', 'origin', 'HEAD'], root, { timeoutMs: PUSH_TIMEOUT_MS });
    if (push.code !== 0) {
        throw new Error(`git push failed:\n${push.stderr.trim()}`);
    }

    const remote = (await git(['remote', 'get-url', 'origin'], root)).stdout.trim();
    const cli = await reviewCliFor(remote, root);
    if (!cli) {
        const url = compareUrl(remote, branch, base);
        if (!url) {
            host.notice('info', `Pushed ${branch}. Open a pull request on your Git host (install the GitHub CLI, gh, or GitLab CLI, glab, to let Nova create it).`);
            return;
        }
        host.notice('info', `Pushed ${branch}. Opening the page to create the pull request.`);
        await host.openExternal(url);
        return;
    }
    const kind = cli === 'glab' ? 'merge request' : 'pull request';
    const existing = await existingRequestUrl(cli, root);
    if (existing) {
        host.notice('info', `Pushed ${branch}; its ${kind} is updated: ${existing}`);
        return;
    }

    const [log, stat, diff] = await Promise.all([
        gitOk(['log', '--format=%s%n%n%b', range], root),
        gitOk(['diff', '--stat', base ? `${base}...HEAD` : 'HEAD'], root),
        gitOk(['diff', base ? `${base}...HEAD` : 'HEAD'], root)
    ]);
    const answer = cleanMessage(await host.complete([
        `Write a ${kind} title and description for the commits below.`,
        '- First line: the title, at most 72 characters, in the style of the commit subjects.',
        '- Then a blank line and the description in Markdown: a short "## Summary" with bullet points of what changed and why, and a "## Test plan" with how it was or can be tested.',
        '- Reply with the title and description only: no code fences around the whole, no commentary.',
        ...(hint ? [`- The author's note: ${hint}`] : []),
        '',
        `Commits:\n${log.trim()}`,
        '',
        `Changed files:\n${stat.trim()}`,
        '',
        `Diff:\n${clip(diff)}`
    ].join('\n'), token));
    if (token.isCancellationRequested) {
        return;
    }
    const final = await confirmText(`Create a ${kind} from ${branch}${baseName ? ` into ${baseName}` : ''}?`, answer || branch, 'Create', `${kind[0].toUpperCase()}${kind.slice(1)} title (the description stays as written)`);
    if (!final) {
        host.notice('info', `Pushed ${branch}. No ${kind} was created.`);
        return;
    }
    const [title, ...rest] = final.split('\n');
    const body = rest.join('\n').trim();
    // glab takes the description as an argument: --description-file only exists in newer versions.
    const created = cli === 'gh'
        ? await run('gh', ['pr', 'create', '--head', branch, ...(baseName ? ['--base', baseName] : []), '--title', title.trim(), '--body-file', '-'], root, { input: body, timeoutMs: PUSH_TIMEOUT_MS })
        : await run('glab', ['mr', 'create', '--source-branch', branch, ...(baseName ? ['--target-branch', baseName] : []), '--title', title.trim(), '--description', body, '--yes'], root, { timeoutMs: PUSH_TIMEOUT_MS });
    if (created.code !== 0) {
        throw new Error(`${cli} could not create the ${kind}:\n${(created.stderr || created.stdout).trim()}`);
    }
    const url = /https?:\/\/\S+/.exec(created.stdout)?.[0] ?? created.stdout.trim();
    host.notice('info', `${kind[0].toUpperCase()}${kind.slice(1)} created: ${url}`);
}

/** The URL of the open pull/merge request of the current branch, if it has one. */
async function existingRequestUrl(cli: ReviewCli, root: string): Promise<string | undefined> {
    if (cli === 'gh') {
        const result = await run('gh', ['pr', 'view', '--json', 'url,state', '-q', 'select(.state == "OPEN") | .url'], root);
        return result.code === 0 ? result.stdout.trim() || undefined : undefined;
    }
    const result = await run('glab', ['mr', 'view', '--output', 'json'], root);
    try {
        const request = JSON.parse(result.stdout) as { web_url?: string; state?: string };
        return result.code === 0 && request.state === 'opened' ? request.web_url : undefined;
    } catch {
        return undefined;
    }
}

async function requireRepo(host: GitCommandHost): Promise<string | undefined> {
    const cwd = host.cwd();
    const root = cwd ? await repoRoot(cwd) : undefined;
    if (!root) {
        host.notice('warning', cwd ? 'This folder is not a git repository (or git is not installed).' : 'Open a folder first.');
    }
    return root;
}

/**
 * Shows a generated message for confirmation; the first line can be edited, the rest stays.
 * Undefined when the user cancels.
 */
async function confirmText(question: string, text: string, confirm: string, editPrompt: string): Promise<string | undefined> {
    const choice = await vscode.window.showInformationMessage(question, { modal: true, detail: text }, confirm, 'Edit…');
    if (choice === confirm) {
        return text;
    }
    if (choice !== 'Edit…') {
        return undefined;
    }
    const [first, ...rest] = text.split('\n');
    const edited = await vscode.window.showInputBox({ title: question, prompt: editPrompt, value: first, valueSelection: [0, first.length] });
    return edited?.trim() ? [edited.trim(), ...rest].join('\n') : undefined;
}

/** A model's answer as plain text: without thinking, a wrapping code fence or quotes. */
export function cleanMessage(text: string): string {
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(cleaned);
    if (fenced) {
        cleaned = fenced[1].trim();
    }
    return cleaned.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
}

function clip(diff: string): string {
    if (diff.length <= MAX_DIFF_CHARS) {
        return diff;
    }
    const half = MAX_DIFF_CHARS / 2;
    return `${diff.slice(0, half)}\n[… ${diff.length - MAX_DIFF_CHARS} characters of the diff left out …]\n${diff.slice(-half)}`;
}

function listFiles(status: string): string {
    const lines = status.trimEnd().split('\n');
    return lines.slice(0, 15).join('\n') + (lines.length > 15 ? `\n… and ${lines.length - 15} more` : '');
}
