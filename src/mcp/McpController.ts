import * as vscode from 'vscode';
import type { McpCommand, McpPageData, McpRow } from './protocol';
import { addServerFlow, removeServerFromFile } from './addServer';
import { openConfig, signInWithBrowser } from './mcpCommand';
import type { McpService } from './McpService';

/** The extension side of the MCP Servers section: lists the servers with their status and answers what the user does with them. */
export class McpController implements vscode.Disposable {
    private readonly subscription: vscode.Disposable;

    public constructor(
        private readonly mcp: McpService,
        /** `project` is where "Add Server" writes; `projectOthers` are the workspace's other config files. */
        private readonly files: () => { user: string; project?: string; projectOthers?: string[] },
        private readonly post: (message: { type: 'mcp'; data: McpPageData }) => void
    ) {
        this.subscription = mcp.onDidChange(() => this.refresh());
    }

    public dispose(): void {
        this.subscription.dispose();
    }

    public async handle(message: McpCommand): Promise<void> {
        switch (message.command) {
            case 'mcp/ready':
                // Servers start in the background; the list follows as they connect.
                void this.mcp.ensureStarted(0).then(() => this.refresh());
                break;
            case 'mcp/signIn':
                await signInWithBrowser(this.mcp, message.name);
                void vscode.window.showInformationMessage(`Signed in to ${message.name}.`);
                break;
            case 'mcp/signOut':
                await this.mcp.signOut(message.name);
                break;
            case 'mcp/reconnect':
                await this.mcp.reconnect(message.name);
                break;
            case 'mcp/setDisabled':
                await this.mcp.setDisabled(message.name, message.disabled);
                break;
            case 'mcp/delete': {
                const files = this.files();
                const where = message.scope === 'project' ? [files.project, ...(files.projectOthers ?? [])].filter((file): file is string => !!file) : [files.user];
                const answer = await vscode.window.showWarningMessage(
                    `Delete the MCP server "${message.name}"?`,
                    { modal: true, detail: `It is removed from ${where.join(' and ')}. Its sign-in is forgotten too.` },
                    'Delete'
                );
                if (answer !== 'Delete') {
                    return;
                }
                let removed = false;
                for (const file of where) {
                    removed = await removeServerFromFile(file, message.name, file === files.user) || removed;
                }
                await this.mcp.signOut(message.name).catch(() => undefined);
                if (!removed) {
                    void vscode.window.showWarningMessage(`"${message.name}" is not in ${where.join(' or ')}. It may come from another config file.`);
                }
                await this.mcp.reload();
                break;
            }
            case 'mcp/add': {
                const files = this.files();
                const file = message.scope === 'project' ? files.project : files.user;
                if (file && await addServerFlow(file, files.user)) {
                    await this.mcp.reload();
                }
                break;
            }
            case 'mcp/openConfig': {
                const files = this.files();
                const file = message.scope === 'project' ? files.project : files.user;
                if (file) {
                    await openConfig(file, files.user);
                }
                return;
            }
        }
        this.refresh();
    }

    public refresh(): void {
        const files = this.files();
        const servers = this.mcp.statuses().map((server): McpRow => ({
            name: server.name,
            scope: server.scope,
            type: server.type,
            status: server.status,
            tools: server.tools,
            ...(server.error ? { error: server.error } : {}),
            ...(server.signedIn !== undefined ? { signedIn: server.signedIn } : {}),
            ...(server.target ? { target: server.target } : {})
        }));
        this.post({ type: 'mcp', data: { servers, hasProject: !!files.project, files } });
    }
}
