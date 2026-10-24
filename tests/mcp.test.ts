import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { CancellationTokenSource } from 'vscode';
import { expand, loadMcpServers, parseServer } from '../src/mcp/config';
import { McpService } from '../src/mcp/McpService';
import { NeedsAuthError, SecretOAuthProvider } from '../src/mcp/oauth';
import { createMcpTool, flattenMcpContent, mcpServerOf, mcpToolName } from '../src/mcp/tools';
import { ToolInputError } from '../src/agent/tools/types';

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-mcp-'));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

async function writeConfig(name: string, servers: Record<string, unknown>): Promise<string> {
    const file = path.join(dir, name);
    await fs.writeFile(file, JSON.stringify({ mcpServers: servers }));
    return file;
}

describe('MCP config', () => {
    it('merges user and project servers, the project winning, only in a trusted workspace', async () => {
        const userFile = await writeConfig('user.json', { a: { command: 'a-user' }, b: { command: 'b' } });
        const projectFile = await writeConfig('project.json', { a: { command: 'a-project' } });

        const trusted = await loadMcpServers({ userFile, projectFiles: [projectFile], trusted: true });
        expect(trusted.servers.map((server) => [server.name, server.scope, server.type === 'stdio' && server.command])).toEqual([
            ['a', 'project', 'a-project'],
            ['b', 'user', 'b']
        ]);

        const untrusted = await loadMcpServers({ userFile, projectFiles: [projectFile], trusted: false });
        expect(untrusted.servers.find((server) => server.name === 'a')).toMatchObject({ scope: 'user', command: 'a-user' });
    });

    it('expands ${VAR} and ${VAR:-default} and infers http from a url', () => {
        const env = { TOKEN: 'secret' };
        expect(expand('Bearer ${TOKEN}/${MISSING:-x}/${MISSING}', env)).toBe('Bearer secret/x/');
        expect(parseServer('gh', 'user', { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } }, env)).toMatchObject({
            type: 'http',
            headers: { Authorization: 'Bearer secret' }
        });
    });

    it('reports invalid entries instead of loading them', async () => {
        const userFile = await writeConfig('user.json', { noCommand: {}, badUrl: { type: 'http', url: 'nope' }, odd: { type: 'ws', url: 'x' } });
        const { servers, errors } = await loadMcpServers({ userFile, trusted: true });
        expect(servers).toEqual([]);
        expect(errors.map((error) => error.name)).toEqual(['noCommand', 'badUrl', 'odd']);
    });
});

describe('MCP tools', () => {
    it('names tools mcp__<server>__<tool>, sanitized, unique and at most 64 characters', () => {
        expect(mcpToolName('git hub', 'create.issue')).toBe('mcp__git_hub__create_issue');
        expect(mcpServerOf('mcp__git_hub__create_issue')).toBe('git_hub');
        const long = mcpToolName('server', 'x'.repeat(80));
        const other = mcpToolName('server', `${'x'.repeat(79)}y`);
        expect(long).toHaveLength(64);
        expect(long).not.toBe(other);
    });

    it('flattens text, resources and images', () => {
        const output = flattenMcpContent([
            { type: 'text', text: 'hello' },
            { type: 'resource', resource: { uri: 'file:///a', text: 'inline' } },
            { type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }
        ]);
        expect(output.text).toBe('hello\ninline\n[Image attached]');
        expect(Buffer.from(output.images[0].data).toString()).toBe('png');
    });

    it('is read-only only with readOnlyHint, and turns isError into a ToolInputError', async () => {
        const entry = (readOnlyHint?: boolean) => ({ server: 's', name: 'mcp__s__t', tool: { name: 't', inputSchema: { type: 'object' as const }, annotations: { readOnlyHint } } });
        const failing = { callTool: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }) };
        expect(createMcpTool(entry(true), failing).readOnly).toBe(true);
        expect(createMcpTool(entry(), failing).readOnly).toBe(false);
        const tool = createMcpTool(entry(), failing);
        await expect(tool.invoke({}, { token: new CancellationTokenSource().token }, { title: '' })).rejects.toBeInstanceOf(ToolInputError);
    });
});

describe('MCP OAuth', () => {
    it('registers a client, signs in through the loopback redirect and keeps the tokens in secret storage', async () => {
        const registered: Array<{ redirect_uris: string[] }> = [];
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', base);
            const json = (body: unknown) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
            let body = '';
            request.on('data', (chunk) => body += chunk);
            request.on('end', () => {
                if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
                    json({ resource: `${base}/mcp`, authorization_servers: [base] });
                } else if (url.pathname === '/.well-known/oauth-authorization-server') {
                    json({
                        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
                        response_types_supported: ['code'], code_challenge_methods_supported: ['S256']
                    });
                } else if (url.pathname === '/register') {
                    const metadata = JSON.parse(body) as { redirect_uris: string[] };
                    registered.push(metadata);
                    json({ ...metadata, client_id: 'nova-client' });
                } else if (url.pathname === '/authorize') {
                    const redirect = new URL(url.searchParams.get('redirect_uri')!);
                    redirect.searchParams.set('code', 'the-code');
                    redirect.searchParams.set('state', url.searchParams.get('state')!);
                    response.writeHead(302, { Location: redirect.toString() }).end();
                } else if (url.pathname === '/token' && new URLSearchParams(body).get('code') === 'the-code') {
                    json({ access_token: 'access', token_type: 'Bearer', refresh_token: 'refresh' });
                } else {
                    response.writeHead(404).end();
                }
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const secrets = new Map<string, string>();
        const store = { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => void secrets.set(key, value), delete: async (key: string) => void secrets.delete(key) };
        const provider = new SecretOAuthProvider(store, 'key', 'remote');
        await provider.load();
        try {
            await provider.authorize(`${base}/mcp`, { open: async (url) => void await fetch(url) });
        } finally {
            server.close();
        }

        expect(registered[0].redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        expect(provider.tokens()?.access_token).toBe('access');
        expect(JSON.parse(secrets.get('key')!)).toMatchObject({ tokens: { access_token: 'access' }, client: { client_id: 'nova-client' } });

        // Outside Connect, a server without a registered client needs the user to sign in.
        expect(() => new SecretOAuthProvider(store, 'other', 'remote').clientInformation()).toThrow(NeedsAuthError);
    });
});

describe('McpService', () => {
    const secrets = new Map<string, string>();
    const secretStore = {
        get: async (key: string) => secrets.get(key),
        store: async (key: string, value: string) => void secrets.set(key, value),
        delete: async (key: string) => void secrets.delete(key)
    };

    async function service(): Promise<McpService> {
        const userFile = await writeConfig('user.json', { echo: { command: 'unused' } });
        const settingsFile = path.join(dir, 'settings.json');
        return new McpService({
            userFile,
            projectFiles: () => [],
            settingsFile: () => settingsFile,
            trusted: () => true,
            cwd: () => dir,
            secrets: secretStore,
            timeoutMs: () => 5_000,
            transports: () => {
                const server = new McpServer({ name: 'echo', version: '1.0.0' });
                server.registerTool('echo', { description: 'Echoes', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
                    async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }));
                server.registerPrompt('greet', { description: 'Greets someone', argsSchema: { name: z.string() } },
                    ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Say hello to ${name}.` } }] }));
                const [client, serverSide] = InMemoryTransport.createLinkedPair();
                void server.connect(serverSide);
                return [client];
            }
        });
    }

    it('connects, lists tools under their Nova names and calls them', async () => {
        const mcp = await service();
        await mcp.ensureStarted(5_000);
        expect(mcp.statuses()).toMatchObject([{ name: 'echo', status: 'connected', tools: 1 }]);
        expect(mcp.tools().map((entry) => entry.name)).toEqual(['mcp__echo__echo']);
        const result = await mcp.callTool('echo', 'echo', { text: 'hi' }, new CancellationTokenSource().token);
        expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }]);
        mcp.dispose();
    });

    it('lists the prompts of servers that have them and fills one in', async () => {
        const mcp = await service();
        await mcp.ensureStarted(5_000);
        expect(mcp.prompts()).toMatchObject([{ server: 'echo', name: 'mcp__echo__greet', prompt: { name: 'greet', description: 'Greets someone', arguments: [{ name: 'name', required: true }] } }]);
        const result = await mcp.getPrompt('echo', 'greet', { name: 'Ada' });
        expect(result.messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Say hello to Ada.' } }]);
        mcp.dispose();
    });

    it('starts a stdio server as a child process and reports what it prints on failure', async () => {
        const sdk = path.resolve('node_modules/@modelcontextprotocol/sdk/dist/cjs');
        const script = path.join(dir, 'server.cjs');
        await fs.writeFile(script, `
            const { McpServer } = require(${JSON.stringify(`${sdk}/server/mcp.js`)});
            const { StdioServerTransport } = require(${JSON.stringify(`${sdk}/server/stdio.js`)});
            const server = new McpServer({ name: 'child', version: '1.0.0' });
            server.registerTool('pid', { description: 'pid' }, async () => ({ content: [{ type: 'text', text: process.env.GREETING }] }));
            server.connect(new StdioServerTransport());`);
        const userFile = await writeConfig('user.json', {
            child: { command: process.execPath, args: [script], env: { GREETING: 'hello' } },
            broken: { command: process.execPath, args: ['-e', 'console.error("missing token"); process.exit(1)'] }
        });
        const mcp = new McpService({
            userFile, projectFiles: () => [], settingsFile: () => undefined, trusted: () => true, cwd: () => dir, secrets: secretStore, timeoutMs: () => 5_000
        });
        await mcp.ensureStarted(10_000);
        const result = await mcp.callTool('child', 'pid', {}, new CancellationTokenSource().token);
        expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
        const broken = mcp.statuses().find((server) => server.name === 'broken');
        expect(broken?.status).toBe('error');
        expect(broken?.error).toContain('missing token');
        mcp.dispose();
    }, 15_000);

    it('disables a server in the project settings and reconnects it when enabled again', async () => {
        const mcp = await service();
        await mcp.ensureStarted(5_000);
        await mcp.setDisabled('echo', true);
        expect(mcp.tools()).toEqual([]);
        expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ disabledMcpServers: ['echo'] });

        await mcp.setDisabled('echo', false);
        expect(mcp.statuses()[0].status).toBe('connected');
        mcp.dispose();
    });
});
