import * as vscode from 'vscode';

/** A file change proposed by a tool, shown as a diff before it is applied. */
export interface ProposedEdit {
    uri: vscode.Uri;
    /** Workspace-relative path for display. */
    path: string;
    /** Content before the change; empty for new files. */
    original: string;
    proposed: string;
    isNewFile: boolean;
}

export interface ToolContext {
    token: vscode.CancellationToken;
}

/** What a tool wants to do before it runs, so the panel can ask for approval. */
export interface ToolPreparation {
    /** Short label shown on the tool card, e.g. "Edit src/app.ts". */
    title: string;
    /** Extra detail for the approval card, e.g. the command line. */
    detail?: string;
    edit?: ProposedEdit;
}

export interface NovaTool<TInput = Record<string, unknown>> {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    /** Read-only tools can run without approval when the approval mode allows it. */
    readonly readOnly: boolean;
    prepare(input: TInput, context: ToolContext): Promise<ToolPreparation>;
    /** Runs the tool. `preparation` is the result of `prepare` for this call. */
    invoke(input: TInput, context: ToolContext, preparation: ToolPreparation): Promise<string | ToolOutput>;
}

/** An image a tool returns, such as a screenshot it opened. */
export interface ToolImage {
    mimeType: string;
    data: Uint8Array;
}

/** A tool's text, with images the model sees when it reads images. */
export interface ToolOutput {
    text: string;
    images: ToolImage[];
}

export function outputText(output: string | ToolOutput): string {
    return typeof output === 'string' ? output : output.text;
}

/** A tool's output as tool result parts: its text, then its images as data parts. */
export function outputParts(output: string | ToolOutput): Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> {
    if (typeof output === 'string') {
        return [new vscode.LanguageModelTextPart(output)];
    }
    return [
        new vscode.LanguageModelTextPart(output.text),
        ...output.images.map((image) => new vscode.LanguageModelDataPart(image.data, image.mimeType))
    ];
}

/** Error whose message is meant for the model, e.g. "old_string not found". */
export class ToolInputError extends Error {
}
