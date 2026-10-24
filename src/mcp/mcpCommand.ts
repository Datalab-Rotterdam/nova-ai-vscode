import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writePrivateFile } from '../storage/NovaHome';
import type { McpServerStatus, McpService } from './McpService';

const STATUS_ICONS: Record<McpServerStatus['status'], string> = {
    connected: '$(pass-filled)',
    connecting: '$(sync~spin)',
    'needs-auth': '$(key)',
    error: '$(error)',
    disabled: '$(circle-slash)'
};

/** Nova AI: MCP Servers — the servers with their status, and what can be done with each. */
export async function manageMcpServers(mcp: McpService, files: { user: string; project?: string }): Promise<void> {
    await mcp.ensureStarted(0);
    type Item = vscode.QuickPickItem & { server?: McpServerStatus; file?: string };
    const items: Item[] = [
        ...mcp.statuses().map((server): Item => ({
            label: `${STATUS_ICONS[server.status]} ${server.name}`,
            description: [server.scope, server.status === 'connected' ? `${server.tools} tools` : server.status].join(' · '),
            detail: server.error?.split('\n')[0],
            server
        })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(edit) Open user config', description: files.user, file: files.user },
        ...(files.project ? [{ label: '$(edit) Open project config', description: files.project, file: files.project }] : [])
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Nova AI: MCP Servers', placeHolder: mcp.statuses().length ? 'Choose a server' : 'No MCP servers yet: open a config to add one' });
    if (picked?.file) {
        await openConfig(picked.file, files.user);
    } else if (picked?.server) {
        await serverActions(mcp, picked.server, files);
    }
}

async function serverActions(mcp: McpService, server: McpServerStatus, files: { user: string; project?: string }): Promise<void> {
    const http = server.type === 'http' || server.type === 'sse';
    const actions = [
        ...(http && server.status !== 'disabled' ? [server.signedIn ? 'Sign in again' : 'Connect (sign in)'] : []),
        ...(server.status !== 'disabled' && server.type !== 'invalid' ? ['Reconnect'] : []),
        ...(server.signedIn ? ['Sign out'] : []),
        ...(server.type !== 'invalid' ? [server.status === 'disabled' ? 'Enable' : 'Disable'] : []),
        ...(server.error ? ['Show error'] : []),
        'Open config'
    ];
    const action = await vscode.window.showQuickPick(actions, { title: server.name });
    try {
        switch (action) {
            case 'Connect (sign in)':
            case 'Sign in again':
                await signInWithBrowser(mcp, server.name);
                void vscode.window.showInformationMessage(`Signed in to ${server.name}.`);
                break;
            case 'Reconnect':
                await mcp.reconnect(server.name);
                break;
            case 'Sign out':
                await mcp.signOut(server.name);
                break;
            case 'Enable':
            case 'Disable':
                await mcp.setDisabled(server.name, action === 'Disable');
                break;
            case 'Show error':
                void vscode.window.showErrorMessage(`${server.name}: ${server.error}`, { modal: true });
                break;
            case 'Open config':
                await openConfig(server.scope === 'project' && files.project ? files.project : files.user, files.user);
                break;
        }
    } catch (error) {
        void vscode.window.showErrorMessage(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Signs in to a server in the browser, with a cancellable progress notification. */
export async function signInWithBrowser(mcp: McpService, server: string): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Signing in to ${server} in your browser…`, cancellable: true }, async (_, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        await mcp.signIn(server, {
            open: async (url) => {
                await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
            },
            external: async (local) => (await vscode.env.asExternalUri(vscode.Uri.parse(local))).toString(),
            signal: controller.signal
        });
    });
}

/** Opens a config file, creating it with an empty server list first; the user's file may hold tokens, so only they can read it. */
async function openConfig(file: string, userFile: string): Promise<void> {
    try {
        await fs.access(file);
    } catch {
        const content = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
        if (file === userFile) {
            await writePrivateFile(file, content);
        } else {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, content);
        }
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file));
}
