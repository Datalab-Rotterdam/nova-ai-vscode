import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { GetPromptResult, Prompt, Tool } from '@modelcontextprotocol/sdk/types.js';
import { writePrivateFile } from '../storage/NovaHome';
import { loadMcpServers, type McpScope, type McpServerConfig } from './config';
import { NeedsAuthError, SecretOAuthProvider, type SecretStore } from './oauth';
import { mcpToolName, type McpPromptEntry, type McpToolCaller, type McpToolEntry } from './tools';

const CLIENT_INFO = { name: 'nova-ai-vscode', version: '1.0.0' };
const STDERR_TAIL_CHARS = 2_000;

export type McpStatus = 'connecting' | 'connected' | 'needs-auth' | 'error' | 'disabled';

export interface McpServerStatus {
    name: string;
    scope: McpScope;
    type: McpServerConfig['type'] | 'invalid';
    status: McpStatus;
    tools: number;
    error?: string;
    /** HTTP servers: whether Nova holds OAuth tokens for it. */
    signedIn?: boolean;
    /** The command line, or the address without its query (it may hold a key). */
    target?: string;
}

export interface McpServiceOptions {
    userFile: string;
    /** The workspace's config files, in order (see config.ts). */
    projectFiles: () => string[];
    /** Private per-project settings, where `disabledMcpServers` is kept (shared with nova-ai-cli). */
    settingsFile: () => string | undefined;
    trusted: () => boolean;
    cwd: () => string | undefined;
    secrets: SecretStore;
    timeoutMs: () => number;
    log?: (message: string, error?: unknown) => void;
    /** Test seam: the transport for a server; defaults to stdio, Streamable HTTP or SSE. */
    transports?: (config: McpServerConfig, auth?: SecretOAuthProvider) => Transport[];
}

interface Connection {
    config: McpServerConfig;
    status: McpStatus;
    client?: Client;
    tools: McpToolEntry[];
    prompts: McpPromptEntry[];
    error?: string;
    auth?: SecretOAuthProvider;
    opening?: Promise<void>;
    stderr: string;
}

/**
 * Nova's own MCP client (docs/NOVA_HOME.md, "MCP servers"). One persistent connection per
 * configured server; a dropped connection reopens on the next call. Servers start in the
 * background on the first chat request, so a slow server never blocks the chat for long.
 */
export class McpService implements McpToolCaller, vscode.Disposable {
    private readonly connections = new Map<string, Connection>();
    private configErrors: McpServerStatus[] = [];
    private loading?: Promise<void>;
    private readonly changed = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.changed.event;

    public constructor(private readonly options: McpServiceOptions) {
    }

    /** Starts the servers (once) and waits for them at most `waitMs`. */
    public async ensureStarted(waitMs: number): Promise<void> {
        this.loading ??= this.reload();
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([this.loading, new Promise<void>((resolve) => timer = setTimeout(resolve, waitMs))]);
        clearTimeout(timer);
    }

    /** Rereads the config: removed servers close, new and changed ones (re)connect. */
    public reload(): Promise<void> {
        this.loading = (async () => {
            const { servers, errors } = await loadMcpServers({
                userFile: this.options.userFile,
                projectFiles: this.options.projectFiles(),
                trusted: this.options.trusted()
            });
            this.configErrors = errors.map((error) => ({ name: error.name, scope: error.scope, type: 'invalid', status: 'error', tools: 0, error: error.message }));
            const disabled = new Set(await this.disabled());
            const names = new Set(servers.map((server) => server.name));
            for (const [name, connection] of this.connections) {
                if (!names.has(name)) {
                    this.connections.delete(name);
                    await connection.client?.close().catch(() => undefined);
                }
            }
            const opening: Promise<void>[] = [];
            for (const config of servers) {
                const existing = this.connections.get(config.name);
                if (existing && JSON.stringify(existing.config) === JSON.stringify(config) && (existing.status === 'disabled') === disabled.has(config.name)) {
                    continue;
                }
                await existing?.client?.close().catch(() => undefined);
                const connection: Connection = { config, status: disabled.has(config.name) ? 'disabled' : 'connecting', tools: [], prompts: [], stderr: '' };
                this.connections.set(config.name, connection);
                if (connection.status !== 'disabled') {
                    opening.push(this.open(connection));
                }
            }
            this.changed.fire();
            await Promise.allSettled(opening);
        })();
        return this.loading;
    }

    /** Reloads when a config file changes or the workspace becomes trusted. */
    public watch(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];
        const reload = () => void this.reload();
        for (const file of [this.options.userFile, ...this.options.projectFiles()]) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
            disposables.push(watcher, watcher.onDidCreate(reload), watcher.onDidChange(reload), watcher.onDidDelete(reload));
        }
        disposables.push(vscode.workspace.onDidGrantWorkspaceTrust?.(reload) ?? { dispose() {} });
        return vscode.Disposable.from(...disposables);
    }

    /** The tools of all connected servers. */
    public tools(): McpToolEntry[] {
        return [...this.connections.values()].filter((connection) => connection.status === 'connected').flatMap((connection) => connection.tools);
    }

    /** The prompts of all connected servers, for the slash command menu. */
    public prompts(): McpPromptEntry[] {
        return [...this.connections.values()].filter((connection) => connection.status === 'connected').flatMap((connection) => connection.prompts);
    }

    /** A prompt filled in with its arguments: the messages to send. */
    public async getPrompt(server: string, name: string, args: Record<string, string>): Promise<GetPromptResult> {
        const connection = this.connections.get(server);
        if (!connection?.client) {
            throw new Error(`MCP server "${server}" is not connected.`);
        }
        return connection.client.getPrompt({ name, arguments: args }, { timeout: this.options.timeoutMs() });
    }

    public statuses(): McpServerStatus[] {
        return [
            ...[...this.connections.values()].map((connection): McpServerStatus => ({
                name: connection.config.name,
                scope: connection.config.scope,
                type: connection.config.type,
                status: connection.status,
                tools: connection.tools.length,
                target: describeTarget(connection.config),
                error: connection.error ? connection.stderr ? `${connection.error}\n${connection.stderr}` : connection.error : undefined,
                ...(connection.auth ? { signedIn: connection.auth.hasTokens } : {})
            })),
            ...this.configErrors
        ];
    }

    public async callTool(server: string, tool: string, args: Record<string, unknown>, token: vscode.CancellationToken): Promise<{ content: unknown[]; isError?: boolean }> {
        const connection = this.connections.get(server);
        if (!connection || connection.status === 'disabled') {
            throw new Error(`MCP server "${server}" is not available.`);
        }
        if (!connection.client) {
            await this.open(connection);
        }
        if (!connection.client) {
            throw new Error(connection.error ?? `MCP server "${server}" is not connected.`);
        }
        const controller = new AbortController();
        const cancel = token.onCancellationRequested(() => controller.abort());
        try {
            const result = await connection.client.callTool({ name: tool, arguments: args }, undefined, { timeout: this.options.timeoutMs(), signal: controller.signal });
            const content = Array.isArray(result.content)
                ? result.content as unknown[]
                : result.structuredContent ? [{ type: 'text', text: JSON.stringify(result.structuredContent, null, 2) }] : [];
            return { content, isError: result.isError === true };
        } finally {
            cancel.dispose();
        }
    }

    /** Signs in to an HTTP server through the browser, then reconnects. */
    public async signIn(name: string, browser: { open(url: URL): Promise<void>; external?(local: string): Promise<string>; signal?: AbortSignal }): Promise<void> {
        const connection = this.connections.get(name);
        if (!connection || connection.config.type === 'stdio') {
            throw new Error(`"${name}" is not an HTTP MCP server.`);
        }
        const auth = connection.auth ?? this.authFor(connection);
        await auth.load();
        await auth.authorize(connection.config.url, browser);
        await this.reconnect(name);
    }

    public async signOut(name: string): Promise<void> {
        const connection = this.connections.get(name);
        await connection?.auth?.forget();
        await this.reconnect(name);
    }

    public async reconnect(name: string): Promise<void> {
        const connection = this.connections.get(name);
        if (!connection || connection.status === 'disabled') {
            return;
        }
        await connection.client?.close().catch(() => undefined);
        connection.client = undefined;
        await this.open(connection);
    }

    public async setDisabled(name: string, disabled: boolean): Promise<void> {
        const file = this.options.settingsFile();
        if (!file) {
            throw new Error('Open a folder to turn MCP servers on or off.');
        }
        const settings = await readJson(file);
        const list = new Set(Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers as string[] : []);
        disabled ? list.add(name) : list.delete(name);
        settings.disabledMcpServers = [...list];
        await writePrivateFile(file, `${JSON.stringify(settings, null, 2)}\n`);
        const connection = this.connections.get(name);
        if (connection) {
            await connection.client?.close().catch(() => undefined);
            connection.client = undefined;
            connection.tools = [];
            connection.prompts = [];
            connection.error = undefined;
            connection.status = disabled ? 'disabled' : 'connecting';
            this.changed.fire();
            if (!disabled) {
                await this.open(connection);
            }
        }
    }

    public dispose(): void {
        for (const connection of this.connections.values()) {
            void connection.client?.close().catch(() => undefined);
        }
        this.connections.clear();
        this.changed.dispose();
    }

    private open(connection: Connection): Promise<void> {
        connection.opening ??= this.openOnce(connection).finally(() => {
            connection.opening = undefined;
            this.changed.fire();
        });
        return connection.opening;
    }

    private async openOnce(connection: Connection): Promise<void> {
        const { config } = connection;
        connection.status = 'connecting';
        connection.error = undefined;
        connection.stderr = '';
        this.changed.fire();

        const auth = config.type === 'stdio' ? undefined : connection.auth ?? this.authFor(connection);
        await auth?.load();
        const transports = this.options.transports?.(config, auth) ?? this.defaultTransports(connection, auth);
        const errors: unknown[] = [];
        for (const transport of transports) {
            const client = new Client(CLIENT_INFO, {
                listChanged: {
                    tools: {
                        onChanged: (error, tools) => {
                            if (!error && tools && connection.client === client) {
                                connection.tools = toEntries(config.name, tools);
                                this.changed.fire();
                            }
                        }
                    },
                    prompts: {
                        onChanged: (error, prompts) => {
                            if (!error && prompts && connection.client === client) {
                                connection.prompts = toPromptEntries(config.name, prompts);
                                this.changed.fire();
                            }
                        }
                    }
                }
            });
            try {
                await client.connect(transport);
                connection.tools = toEntries(config.name, await listAllTools(client));
                // Only servers that say they have prompts are asked; some others answer with an error.
                connection.prompts = client.getServerCapabilities()?.prompts ? toPromptEntries(config.name, await listAllPrompts(client).catch(() => [])) : [];
                connection.client = client;
                connection.status = 'connected';
                client.onclose = () => {
                    if (connection.client === client) {
                        connection.client = undefined;
                        connection.status = 'error';
                        connection.error = 'The connection closed; it reopens on the next tool call.';
                        this.changed.fire();
                    }
                };
                return;
            } catch (error) {
                errors.push(error);
                await client.close().catch(() => undefined);
                if (isAuthError(error)) {
                    break;
                }
            }
        }
        connection.tools = [];
        connection.prompts = [];
        const lastError = errors[errors.length - 1];
        connection.status = isAuthError(lastError) ? 'needs-auth' : 'error';
        connection.error = isAuthError(lastError)
            ? new NeedsAuthError(config.name).message
            // The first transport is the one that matters (Streamable HTTP); the fallback's error alone would hide why it failed.
            : errors.length > 1 ? `${errorMessage(errors[0])}\nThen the SSE fallback failed: ${errorMessage(lastError)}` : errorMessage(lastError);
        this.options.log?.(`MCP server "${config.name}" did not connect.`, errors.length > 1 ? errors : lastError);
    }

    /** stdio; or Streamable HTTP with SSE as fallback (nova-ai-next `connect`), or SSE alone. */
    private defaultTransports(connection: Connection, auth?: SecretOAuthProvider): Transport[] {
        const { config } = connection;
        if (config.type === 'stdio') {
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: { ...definedEnv(process.env), ...config.env },
                cwd: this.options.cwd(),
                stderr: 'pipe'
            });
            transport.stderr?.on('data', (chunk: Buffer) => {
                connection.stderr = (connection.stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
            });
            return [transport];
        }
        const url = new URL(config.url);
        const options = { requestInit: { headers: config.headers }, authProvider: auth };
        const sse = new SSEClientTransport(url, options);
        return config.type === 'sse' ? [sse] : [new StreamableHTTPClientTransport(url, options), sse];
    }

    private authFor(connection: Connection): SecretOAuthProvider {
        const config = connection.config as Extract<McpServerConfig, { url: string }>;
        const key = `nova.mcp.oauth/${createHash('sha1').update(`${config.scope}|${config.name}|${config.url}`).digest('hex')}`;
        connection.auth = new SecretOAuthProvider(this.options.secrets, key, config.name, config.oauth);
        return connection.auth;
    }

    private async disabled(): Promise<string[]> {
        const file = this.options.settingsFile();
        const value = file ? (await readJson(file)).disabledMcpServers : undefined;
        return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
    }
}

function describeTarget(config: McpServerConfig): string {
    if (config.type === 'stdio') {
        return [config.command, ...config.args].join(' ');
    }
    try {
        const url = new URL(config.url);
        return `${url.origin}${url.pathname}`;
    } catch {
        return config.url;
    }
}

function toEntries(server: string, tools: Tool[]): McpToolEntry[] {
    return tools.map((tool) => ({ server, name: mcpToolName(server, tool.name), tool }));
}

function toPromptEntries(server: string, prompts: Prompt[]): McpPromptEntry[] {
    return prompts.map((prompt) => ({ server, name: mcpToolName(server, prompt.name), prompt }));
}

async function listAllPrompts(client: Client): Promise<Prompt[]> {
    const prompts: Prompt[] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listPrompts(cursor ? { cursor } : undefined);
        prompts.push(...page.prompts);
        cursor = page.nextCursor;
    } while (cursor);
    return prompts;
}

async function listAllTools(client: Client): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor);
    return tools;
}

function isAuthError(error: unknown): boolean {
    return error instanceof NeedsAuthError || error instanceof UnauthorizedError;
}

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'The server did not respond.';
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
    try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}
