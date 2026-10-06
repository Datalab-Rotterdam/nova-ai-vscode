import * as vscode from 'vscode';

/** The Nova AI help page, shipped with the extension (Markdown, so it also reads well on GitHub). */
export const HELP_PAGE = ['resources', 'help', 'HELP.md'] as const;

/** Opens the help page rendered in VS Code's Markdown preview, or as text when that is unavailable. */
export async function openHelp(extensionUri: vscode.Uri): Promise<void> {
    const uri = vscode.Uri.joinPath(extensionUri, ...HELP_PAGE);
    try {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch {
        // The built-in Markdown extension is disabled.
        await vscode.window.showTextDocument(uri, { preview: true });
    }
}
