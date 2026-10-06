import * as path from 'node:path';
import * as vscode from 'vscode';
import { NovaTool, ToolInputError, type ProposedEdit, type ToolPreparation } from './types';
import { bundledMessage, bundledSkillOf } from '../../skills/SkillService';
import { displayPath, exists, readText, resolveWorkspacePath } from './workspacePaths';

/** A path the edit tools may change: in the workspace, and not part of a bundled skill. */
function resolveEditablePath(input: unknown): vscode.Uri {
    const uri = resolveWorkspacePath(input);
    const bundled = bundledSkillOf(uri.fsPath);
    if (bundled) {
        throw new ToolInputError(bundledMessage({ name: path.basename(bundled.root), bundled: bundled.bundle }));
    }
    return uri;
}

interface EditFileInput { path: string; old_string: string; new_string: string; replace_all?: boolean }

export const editFileTool: NovaTool<EditFileInput> = {
    name: 'edit_file',
    description:
        'Edit a file by replacing an exact snippet. old_string must match the file exactly (including whitespace and indentation) ' +
        'and be unique unless replace_all is true; include a few surrounding lines to make it unique. Read the file first.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Workspace-relative path of the file to edit.' },
            old_string: { type: 'string', description: 'Exact text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one.' }
        },
        required: ['path', 'old_string', 'new_string']
    },
    readOnly: false,
    async prepare(input) {
        const uri = resolveEditablePath(input.path);
        if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
            throw new ToolInputError('"old_string" and "new_string" must be strings.');
        }
        if (!input.old_string) {
            throw new ToolInputError('"old_string" is empty. Use create_file to write a new file.');
        }

        let original: string;
        try {
            original = await readText(uri);
        } catch {
            throw new ToolInputError(`File "${input.path}" does not exist. Use create_file to create it.`);
        }

        const proposed = replaceSnippet(original, input.old_string, input.new_string, input.replace_all === true);
        return editPreparation(uri, original, proposed, false);
    },
    invoke: applyPreparedEdit
};

interface CreateFileInput { path: string; content: string }

export const createFileTool: NovaTool<CreateFileInput> = {
    name: 'create_file',
    description: 'Create a new file with the given content, or overwrite an existing one completely. Prefer edit_file for changes to existing files.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Workspace-relative path of the file.' },
            content: { type: 'string', description: 'Full file content.' }
        },
        required: ['path', 'content']
    },
    readOnly: false,
    async prepare(input) {
        const uri = resolveEditablePath(input.path);
        if (typeof input.content !== 'string') {
            throw new ToolInputError('"content" must be a string.');
        }
        const isNew = !(await exists(uri));
        const original = isNew ? '' : await readText(uri);
        return editPreparation(uri, original, input.content, isNew);
    },
    invoke: applyPreparedEdit
};

/**
 * Replaces `oldString` in `text`. Line endings are normalized so a model that writes `\n`
 * still matches files with `\r\n`; the file's own line endings are kept.
 */
export function replaceSnippet(text: string, oldString: string, newString: string, replaceAll: boolean): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const normalize = (value: string) => value.replace(/\r\n/g, '\n');
    const source = normalize(text);
    const search = normalize(oldString);
    const replacement = normalize(newString);

    const count = source.split(search).length - 1;
    if (count === 0) {
        throw new ToolInputError('old_string was not found in the file. Read the file again and copy the text exactly, including indentation.');
    }
    if (count > 1 && !replaceAll) {
        throw new ToolInputError(`old_string occurs ${count} times. Add surrounding lines to make it unique, or set replace_all to true.`);
    }

    const result = replaceAll ? source.split(search).join(replacement) : source.replace(search, () => replacement);
    return eol === '\r\n' ? result.replace(/\n/g, '\r\n') : result;
}

function editPreparation(uri: vscode.Uri, original: string, proposed: string, isNewFile: boolean): ToolPreparation {
    const path = displayPath(uri);
    const edit: ProposedEdit = { uri, path, original, proposed, isNewFile };
    const { added, removed } = lineStats(original, proposed);
    return {
        title: `${isNewFile ? 'Create' : 'Edit'} ${path}`,
        detail: `+${added} −${removed}`,
        edit
    };
}

async function applyPreparedEdit(_input: unknown, _context: unknown, preparation: ToolPreparation): Promise<string> {
    const edit = preparation.edit;
    if (!edit) {
        throw new Error('No prepared edit to apply.');
    }

    if (edit.isNewFile) {
        await vscode.workspace.fs.writeFile(edit.uri, new TextEncoder().encode(edit.proposed));
        return `Created ${edit.path}.`;
    }

    // Apply through the document so unsaved editor changes and undo history are respected.
    const document = await vscode.workspace.openTextDocument(edit.uri);
    if (document.getText() !== edit.original) {
        throw new ToolInputError(`${edit.path} changed while the edit was waiting for approval. Read it again and retry.`);
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(edit.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), edit.proposed);
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
        throw new Error(`VS Code could not apply the edit to ${edit.path}.`);
    }
    await document.save();
    const { added, removed } = lineStats(edit.original, edit.proposed);
    return `Edited ${edit.path} (+${added} −${removed} lines).`;
}

/** Counts changed lines with a simple common prefix/suffix comparison. */
export function lineStats(original: string, proposed: string): { added: number; removed: number } {
    const before = original ? original.split(/\r?\n/) : [];
    const after = proposed ? proposed.split(/\r?\n/) : [];
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (end < before.length - start && end < after.length - start
        && before[before.length - 1 - end] === after[after.length - 1 - end]) {
        end++;
    }
    return { added: after.length - start - end, removed: before.length - start - end };
}
