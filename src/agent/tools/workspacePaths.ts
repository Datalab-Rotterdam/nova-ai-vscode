import { AsyncLocalStorage } from 'node:async_hooks';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ToolInputError } from './types';

/** The project's scratch folder in ~/.nova-ai, where the agent may also read and write. */
let scratchRoot: string | undefined;

export function setScratchRoot(dir: string | undefined): void {
    scratchRoot = dir;
}

export function getScratchRoot(): string | undefined {
    return scratchRoot;
}

/**
 * The folder tools work in instead of the workspace, for an agent in its own git worktree.
 * ponytail: implicit (AsyncLocalStorage) rather than a root on every tool call, so path
 * handling stays in this file; pass it explicitly if tools ever run outside the agent's call chain.
 */
const toolRootStorage = new AsyncLocalStorage<string>();

/** Runs `work` with the tools rooted at `root`: paths resolve there and nothing outside it is reachable. */
export function withToolRoot<T>(root: string, work: () => T): T {
    return toolRootStorage.run(root, work);
}

/** The worktree the current tool call is rooted at, if any. */
export function toolRoot(): string | undefined {
    return toolRootStorage.getStore();
}

export function workspaceFolders(): readonly vscode.WorkspaceFolder[] {
    const root = toolRoot();
    if (root) {
        return [{ uri: vscode.Uri.file(root), name: path.basename(root), index: 0 }];
    }
    return vscode.workspace.workspaceFolders ?? [];
}

/**
 * Resolves a path given by the model to a URI inside the workspace. Relative paths
 * resolve against the first workspace folder (or `folder/…` for multi-root workspaces).
 * Anything outside the workspace folders is rejected.
 */
export function resolveWorkspacePath(input: unknown): vscode.Uri {
    if (typeof input !== 'string' || !input.trim()) {
        throw new ToolInputError('A non-empty "path" is required.');
    }

    const raw = input.trim().replace(/^file:\/\//, '');

    // `scratch/...` addresses the project's scratch folder outside the repo.
    if (scratchRoot && /^scratch(?:[\\/]|$)/.test(raw)) {
        const candidate = path.resolve(scratchRoot, raw.replace(/^scratch[\\/]?/, ''));
        if (!isInside(scratchRoot, candidate)) {
            throw new ToolInputError(`Path "${input}" is outside the scratch folder.`);
        }
        return vscode.Uri.file(candidate);
    }

    const folders = workspaceFolders();
    if (!folders.length && !scratchRoot) {
        throw new ToolInputError('No workspace folder is open.');
    }

    let candidate: string;
    if (path.isAbsolute(raw)) {
        candidate = path.normalize(raw);
    } else if (!folders.length) {
        throw new ToolInputError('No workspace folder is open; use a scratch/ path.');
    } else {
        const [first, ...rest] = raw.split(/[\\/]/);
        const named = folders.length > 1 ? folders.find((folder) => folder.name === first) : undefined;
        candidate = named
            ? path.resolve(named.uri.fsPath, ...rest)
            : path.resolve(folders[0].uri.fsPath, raw);
    }

    const inside = folders.some((folder) => isInside(folder.uri.fsPath, candidate))
        || Boolean(scratchRoot && isInside(scratchRoot, candidate));
    if (!inside) {
        throw new ToolInputError(`Path "${input}" is outside the workspace.`);
    }

    return vscode.Uri.file(candidate);
}

export function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function displayPath(uri: vscode.Uri): string {
    const root = toolRoot();
    if (root && isInside(root, uri.fsPath)) {
        return path.relative(root, uri.fsPath).split(path.sep).join('/') || '.';
    }
    if (scratchRoot && isInside(scratchRoot, uri.fsPath)) {
        const relative = path.relative(scratchRoot, uri.fsPath);
        return relative ? `scratch/${relative.split(path.sep).join('/')}` : 'scratch';
    }
    return vscode.workspace.asRelativePath(uri, workspaceFolders().length > 1);
}

/** Reads a file, preferring the open (possibly unsaved) editor buffer. */
export async function readText(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (open) {
        return open.getText();
    }
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export function truncateMiddle(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    const half = Math.floor(maxChars / 2);
    return `${text.slice(0, half)}\n[… ${text.length - maxChars} characters omitted …]\n${text.slice(text.length - half)}`;
}
