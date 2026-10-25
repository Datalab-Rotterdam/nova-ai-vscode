import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writePrivateFile } from '../storage/NovaHome';
import { openConfig } from './mcpCommand';

export type ServerKind = 'stdio' | 'http' | 'npm' | 'pip' | 'docker';

/** What the user typed for a new server. */
export interface ServerInput {
    kind: ServerKind;
    /** stdio: the command line; http: the URL; npm, pip, docker: the package or image. */
    target: string;
    /** Extra arguments after the package or image (npm, pip, docker). */
    args?: string;
    /** http: the Authorization header value; empty: Nova signs in with OAuth. */
    authorization?: string;
    /** `KEY=value` pairs for a local server. */
    env?: Record<string, string>;
}

/** Splits a command line into words; quotes group words. */
export function splitCommand(line: string): string[] {
    return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}

/** `KEY=value, OTHER=${VAR}` as a map; undefined when a pair has no key. */
export function parseEnv(text: string): Record<string, string> | undefined {
    const env: Record<string, string> = {};
    for (const pair of text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)) {
        const at = pair.indexOf('=');
        if (at < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.slice(0, at).trim())) {
            return undefined;
        }
        env[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
    }
    return env;
}

/** The entry for the `mcpServers` of a config file (docs/NOVA_HOME.md, "MCP servers"). */
export function serverEntry(input: ServerInput): Record<string, unknown> {
    if (input.kind === 'http') {
        return {
            type: 'http',
            url: input.target.trim(),
            ...(input.authorization?.trim() ? { headers: { Authorization: input.authorization.trim() } } : {})
        };
    }
    const extra = splitCommand(input.args ?? '');
    const [command, ...args] = input.kind === 'stdio'
        ? splitCommand(input.target)
        : input.kind === 'npm'
            ? ['npx', '-y', input.target.trim(), ...extra]
            : input.kind === 'pip'
                ? ['uvx', input.target.trim(), ...extra]
                : ['docker', 'run', '-i', '--rm', ...dockerEnv(input.env), input.target.trim(), ...extra];
    return {
        command,
        ...(args.length ? { args } : {}),
        // For Docker they are in the environment of `docker run`, which passes them on with -e.
        ...(input.env && Object.keys(input.env).length ? { env: input.env } : {})
    };
}

/** `-e KEY` for each variable: the container gets the value from the environment `docker run` starts in. */
function dockerEnv(env: Record<string, string> | undefined): string[] {
    return Object.keys(env ?? {}).flatMap((key) => ['-e', key]);
}

/** A name for the server: the package without scope and prefix, or the host. */
export function defaultName(input: Pick<ServerInput, 'kind' | 'target'>): string {
    const target = input.target.trim();
    let name: string;
    if (input.kind === 'http') {
        try {
            name = new URL(target).hostname.replace(/^(www|mcp|api)\./, '').split('.')[0];
        } catch {
            name = '';
        }
    } else if (input.kind === 'stdio') {
        name = path.basename(splitCommand(target).find((word) => !word.startsWith('-') && !['npx', 'uvx', 'node', 'python', 'python3', 'docker', 'run'].includes(word)) ?? '');
    } else {
        name = path.basename(target.split(/[:@]/)[0] || target);
        if (input.kind === 'npm' && target.startsWith('@')) {
            name = target.slice(1).split('/')[1]?.split('@')[0] ?? name;
        }
    }
    return name.replace(/^(mcp-server-|server-|mcp-)/, '').replace(/(-mcp|-server|-mcp-server)$/, '').replace(/[^A-Za-z0-9_.-]/g, '-') || 'server';
}

export const SERVER_NAME = /^[A-Za-z0-9_.-]+$/;

/** Adds a server to the `mcpServers` of a config file, keeping everything else in it. */
export async function addServerToFile(file: string, name: string, entry: Record<string, unknown>, privateFile: boolean): Promise<void> {
    let config: { mcpServers?: Record<string, unknown>; [key: string]: unknown } = {};
    try {
        config = JSON.parse(await fs.readFile(file, 'utf8')) as typeof config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(`${file} is not valid JSON. Fix it first (Edit config), then add the server.`);
        }
    }
    config.mcpServers = { ...(config.mcpServers ?? {}), [name]: entry };
    const text = `${JSON.stringify(config, null, 2)}\n`;
    if (privateFile) {
        await writePrivateFile(file, text);
    } else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
    }
}

/** Removes a server from the `mcpServers` of a config file; false when the file does not have it. */
export async function removeServerFromFile(file: string, name: string, privateFile: boolean): Promise<boolean> {
    let config: { mcpServers?: Record<string, unknown>; [key: string]: unknown };
    try {
        config = JSON.parse(await fs.readFile(file, 'utf8')) as typeof config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw new Error(`${file} is not valid JSON. Fix it first (Edit config), then delete the server.`);
    }
    if (!config.mcpServers || !Object.hasOwn(config.mcpServers, name)) {
        return false;
    }
    const { [name]: _removed, ...rest } = config.mcpServers;
    config.mcpServers = rest;
    const text = `${JSON.stringify(config, null, 2)}\n`;
    await (privateFile ? writePrivateFile(file, text) : fs.writeFile(file, text));
    return true;
}

async function existingNames(file: string): Promise<Set<string>> {
    try {
        const config = JSON.parse(await fs.readFile(file, 'utf8')) as { mcpServers?: object };
        return new Set(Object.keys(config.mcpServers ?? {}));
    } catch {
        return new Set();
    }
}

type KindItem = vscode.QuickPickItem & { kind_?: ServerKind | 'edit' };

/**
 * "Add Server": asks what kind of server, then for its command or address, a name and
 * (for a local one) environment variables, and writes it to the config file. Returns
 * whether a server was added.
 */
export async function addServerFlow(file: string, userFile: string): Promise<boolean> {
    const items: KindItem[] = [
        { label: 'Command (stdio)', description: 'Run a local command that implements the MCP protocol', kind_: 'stdio' },
        { label: 'HTTP (HTTP or Server-Sent Events)', description: 'Connect to a remote server that implements the MCP protocol', kind_: 'http' },
        { label: 'Install from a package', kind: vscode.QuickPickItemKind.Separator },
        { label: 'NPM Package', description: 'Run with npx from an NPM package name', kind_: 'npm' },
        { label: 'Pip Package', description: 'Run with uvx from a Python package name', kind_: 'pip' },
        { label: 'Docker Image', description: 'Run a Docker image', kind_: 'docker' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: 'Edit the config file…', description: file, kind_: 'edit' }
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Add MCP Server', placeHolder: 'Choose the type of MCP server to add' });
    if (!picked?.kind_) {
        return false;
    }
    if (picked.kind_ === 'edit') {
        await openConfig(file, userFile);
        return false;
    }
    const kind = picked.kind_;
    const ask = (prompt: string, placeHolder: string, validateInput?: (value: string) => string | undefined, value?: string) =>
        vscode.window.showInputBox({ title: 'Add MCP Server', prompt, placeHolder, validateInput, value, ignoreFocusOut: true });

    const target = await ask(
        { stdio: 'The command that starts the server', http: 'The address of the server', npm: 'The NPM package', pip: 'The Python package', docker: 'The Docker image' }[kind],
        { stdio: 'npx -y @modelcontextprotocol/server-filesystem .', http: 'https://mcp.example.com/mcp', npm: '@modelcontextprotocol/server-memory', pip: 'mcp-server-git', docker: 'mcp/fetch' }[kind],
        (value) => {
            if (!value.trim()) {
                return 'Required.';
            }
            if (kind === 'http') {
                try {
                    return /^https?:$/.test(new URL(value.trim()).protocol) ? undefined : 'Use an http:// or https:// address.';
                } catch {
                    return 'Not a valid address.';
                }
            }
            return undefined;
        }
    );
    if (!target) {
        return false;
    }
    let args: string | undefined;
    let authorization: string | undefined;
    let env: Record<string, string> | undefined;
    if (kind === 'http') {
        authorization = await ask('Authorization header (optional)', 'Bearer ${GITHUB_TOKEN}. Leave empty to sign in with your browser.');
        if (authorization === undefined) {
            return false;
        }
    } else {
        if (kind !== 'stdio') {
            args = await ask('Arguments after the name (optional)', '--readonly');
            if (args === undefined) {
                return false;
            }
        }
        const envText = await ask('Environment variables (optional)', 'API_KEY=${API_KEY}, REGION=eu', (value) => parseEnv(value) ? undefined : 'Use KEY=value pairs separated by commas.');
        if (envText === undefined) {
            return false;
        }
        env = parseEnv(envText);
    }
    const taken = await existingNames(file);
    const name = await ask('A name for the server', defaultName({ kind, target }), (value) => {
        if (!SERVER_NAME.test(value)) {
            return 'Use letters, digits, "-", "_" and ".".';
        }
        return taken.has(value) ? `There is already a server called "${value}" in this file.` : undefined;
    }, defaultName({ kind, target }));
    if (!name) {
        return false;
    }
    await addServerToFile(file, name, serverEntry({ kind, target, args, authorization, env }), file === userFile);
    return true;
}
