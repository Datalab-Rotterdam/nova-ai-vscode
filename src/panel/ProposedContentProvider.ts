import * as vscode from 'vscode';

export const PROPOSED_SCHEME = 'nova-proposed';

/** Serves in-memory file contents for diff previews of proposed edits. */
export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
    private readonly contents = new Map<string, string>();
    private readonly didChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.didChangeEmitter.event;

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    /** Registers content under a unique URI that keeps the file name, so syntax highlighting works. */
    public register(key: string, path: string, content: string): vscode.Uri {
        const uri = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${path}`, query: key });
        this.contents.set(uri.toString(), content);
        this.didChangeEmitter.fire(uri);
        return uri;
    }

    public dispose(): void {
        this.contents.clear();
        this.didChangeEmitter.dispose();
    }
}
