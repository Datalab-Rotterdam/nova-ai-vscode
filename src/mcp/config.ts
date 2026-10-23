import { promises as fs } from 'node:fs';

/**
 * MCP servers from `~/.nova-ai/mcp.json` (the user's) and the project's, shared with the team:
 * `<workspace>/.mcp.json` (also read by nova-ai-cli and Claude Code), then
 * `<workspace>/.nova-ai/mcp.json`. All in Claude's format (docs/NOVA_HOME.md, "MCP servers"):
 *
 * ```json
 * { "mcpServers": {
 *     "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
 *     "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" } } }
 * ```
 *
 * A later file replaces a server of the same name from an earlier one. Project servers only load in a
 * trusted workspace: a cloned repository must not start programs of its own.
 */
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export type McpScope = 'user' | 'project';

export interface McpStdioConfig {
    name: string;
    scope: McpScope;
    type: 'stdio';
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface McpHttpConfig {
    name: string;
    scope: McpScope;
    /** `http` tries Streamable HTTP first and falls back to SSE; `sse` uses SSE only. */
    type: 'http' | 'sse';
    url: string;
    headers: Record<string, string>;
    oauth?: McpOAuthConfig;
}

export interface McpOAuthConfig {
    /** A client registered by hand; without it Nova registers itself (dynamic client registration). */
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    /** Fixed port for the redirect `http://127.0.0.1:<port>/callback`, for a client registered by hand. */
    callbackPort?: number;
}

export interface McpConfigError {
    name: string;
    scope: McpScope;
    message: string;
}

export interface McpConfigSources {
    userFile: string;
    /** In order; a later file wins. */
    projectFiles?: string[];
    trusted: boolean;
    env?: NodeJS.ProcessEnv;
}

export async function loadMcpServers(sources: McpConfigSources): Promise<{ servers: McpServerConfig[]; errors: McpConfigError[] }> {
    const env = sources.env ?? process.env;
    const byName = new Map<string, McpServerConfig>();
    const errors: McpConfigError[] = [];
    const files: Array<[string, McpScope]> = [
        [sources.userFile, 'user'],
        ...(sources.trusted ? sources.projectFiles ?? [] : []).map((file): [string, McpScope] => [file, 'project'])
    ];
    for (const [file, scope] of files) {
        const entries = await readServers(file);
        for (const [name, raw] of Object.entries(entries)) {
            const parsed = parseServer(name, scope, raw, env);
            if (typeof parsed === 'string') {
                errors.push({ name, scope, message: parsed });
            } else {
                byName.set(name, parsed);
            }
        }
    }
    return { servers: [...byName.values()], errors };
}

/** A server entry, or why it is invalid. */
export function parseServer(name: string, scope: McpScope, raw: unknown, env: NodeJS.ProcessEnv = process.env): McpServerConfig | string {
    if (!raw || typeof raw !== 'object') {
        return 'The entry is not an object.';
    }
    const entry = raw as Record<string, unknown>;
    const type = typeof entry.type === 'string' ? entry.type : entry.url ? 'http' : 'stdio';
    if (type === 'stdio') {
        if (typeof entry.command !== 'string' || !entry.command.trim()) {
            return 'A "command" is required.';
        }
        return {
            name, scope, type,
            command: expand(entry.command, env),
            args: strings(entry.args).map((arg) => expand(arg, env)),
            env: stringMap(entry.env, env)
        };
    }
    if (type === 'http' || type === 'streamable-http' || type === 'sse') {
        const url = typeof entry.url === 'string' ? expand(entry.url, env) : '';
        try {
            new URL(url);
        } catch {
            return `"${url}" is not a valid URL.`;
        }
        const oauth = entry.oauth && typeof entry.oauth === 'object' ? entry.oauth as Record<string, unknown> : undefined;
        return {
            name, scope, url,
            type: type === 'sse' ? 'sse' : 'http',
            headers: stringMap(entry.headers, env),
            ...(oauth ? {
                oauth: {
                    clientId: typeof oauth.clientId === 'string' ? expand(oauth.clientId, env) : undefined,
                    clientSecret: typeof oauth.clientSecret === 'string' ? expand(oauth.clientSecret, env) : undefined,
                    scope: typeof oauth.scope === 'string' ? oauth.scope : undefined,
                    callbackPort: typeof oauth.callbackPort === 'number' ? oauth.callbackPort : undefined
                }
            } : {})
        };
    }
    return `Unknown type "${type}" (use stdio, http or sse).`;
}

/** `${VAR}` and `${VAR:-default}` from the environment, as in Claude's `.mcp.json`. */
export function expand(value: string, env: NodeJS.ProcessEnv = process.env): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => env[name] ?? fallback ?? '');
}

async function readServers(file: string): Promise<Record<string, unknown>> {
    try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { mcpServers?: unknown };
        return parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringMap(value: unknown, env: NodeJS.ProcessEnv): Record<string, string> {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, item]) => [key, expand(item, env)]));
}
