import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writePrivateFile } from '../storage/NovaHome';
import type { McpService } from './McpService';

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
export async function openConfig(file: string, userFile: string): Promise<void> {
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
