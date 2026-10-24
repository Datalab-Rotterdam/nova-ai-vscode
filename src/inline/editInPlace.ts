import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ProposedContentProvider } from '../panel/ProposedContentProvider';
import { complete, inlineModel, type InlineClient } from './inlineModel';

const CONTEXT_LINES = 40;
const MAX_TOKENS = 4_096;

const SYSTEM = [
    'You edit code. The user sends part of a file with the selection to change between <selection> tags, and an instruction.',
    'Reply with only the new text for the selection: no explanation, no code fences, nothing from before or after it.',
    'Keep the indentation and style of the surrounding code; change only what the instruction asks for.'
].join('\n');

export interface EditInPlaceDeps {
    client(): Promise<InlineClient | undefined>;
    /** Models to choose from when `nova.inline.model` is not set yet. */
    models(): Promise<ReadonlyArray<{ id: string; name: string }>>;
    proposed: ProposedContentProvider;
}

/**
 * Nova AI: Edit Selection. The model rewrites the selection (or the current line) as asked;
 * the change shows as a diff and is applied only when the user accepts it and the file has not
 * changed meanwhile.
 */
export async function editSelection(deps: EditInPlaceDeps): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const document = editor.document;
    const range = editor.selection.isEmpty ? document.lineAt(editor.selection.active.line).range : new vscode.Range(editor.selection.start, editor.selection.end);
    const selected = document.getText(range);
    const instruction = (await vscode.window.showInputBox({
        title: 'Nova: edit selection',
        prompt: editor.selection.isEmpty ? 'What should change in this line?' : 'What should change in the selection?',
        placeHolder: 'For example: add error handling, use async/await, rename to camelCase'
    }))?.trim();
    if (!instruction) {
        return;
    }
    const model = inlineModel() ?? await chooseModel(deps);
    const client = model ? await deps.client() : undefined;
    if (!model || !client) {
        if (model) {
            void vscode.window.showErrorMessage('Connect Nova AI first.');
        }
        return;
    }

    const version = document.version;
    let replacement: string | undefined;
    try {
        replacement = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Nova is editing…', cancellable: true }, async (_, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            return complete(client, model, SYSTEM, buildEditPrompt(document, range, instruction), { maxTokens: MAX_TOKENS, signal: controller.signal, prediction: selected });
        });
    } catch (error) {
        if (!(error instanceof Error && /abort|cancel/i.test(error.message))) {
            void vscode.window.showErrorMessage(`Nova could not edit the selection: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
    }
    if (!replacement || replacement === selected) {
        void vscode.window.showInformationMessage('Nova had no change for the selection.');
        return;
    }
    // Keep the selection's final newline when the model dropped it.
    if (selected.endsWith('\n') && !replacement.endsWith('\n')) {
        replacement += '\n';
    }

    const id = randomUUID();
    const path = vscode.workspace.asRelativePath(document.uri);
    const full = document.getText();
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    const before = deps.proposed.register(`inline-${id}-before`, path, full);
    const after = deps.proposed.register(`inline-${id}-after`, path, full.slice(0, start) + replacement + full.slice(end));
    await vscode.commands.executeCommand('vscode.diff', before, after, `${path} (Nova edit)`, { preview: true });

    const choice = await vscode.window.showInformationMessage(`Apply Nova's edit to ${path}?`, 'Apply', 'Discard');
    if (choice !== 'Apply') {
        return;
    }
    if (document.version !== version) {
        void vscode.window.showWarningMessage(`${path} changed while Nova was editing; the edit was not applied. Run it again.`);
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, replacement);
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(range.start, document.positionAt(start + replacement.length)) });
}

/** The selection with up to 40 lines before and after it, and the instruction. */
export function buildEditPrompt(document: vscode.TextDocument, range: vscode.Range, instruction: string): string {
    const first = Math.max(0, range.start.line - CONTEXT_LINES);
    const last = Math.min(document.lineCount - 1, range.end.line + CONTEXT_LINES);
    const before = document.getText(new vscode.Range(new vscode.Position(first, 0), range.start));
    const after = document.getText(new vscode.Range(range.end, new vscode.Position(last, document.lineAt(last).text.length)));
    return [
        `File: ${vscode.workspace.asRelativePath(document.uri)} (${document.languageId})`,
        `${before}<selection>${document.getText(range)}</selection>${after}`,
        '',
        `Instruction: ${instruction}`
    ].join('\n');
}

/** Asks for the inline model once and saves it in the user's settings. */
async function chooseModel(deps: EditInPlaceDeps): Promise<string | undefined> {
    const models = await deps.models();
    if (!models.length) {
        void vscode.window.showErrorMessage('No Nova models are available. Connect Nova AI first.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(models.map((model) => ({ label: model.name, description: model.id, id: model.id })), {
        title: 'Model for inline edits',
        placeHolder: 'A fast model works best; change it later in the setting nova.inline.model'
    });
    if (picked) {
        await vscode.workspace.getConfiguration('nova').update('inline.model', picked.id, vscode.ConfigurationTarget.Global);
    }
    return picked?.id;
}
