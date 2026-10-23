import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthConfig } from './config';

/** How long Connect waits for the browser to come back. */
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

export interface SecretStore {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
}

/** What one server's OAuth state keeps in VS Code's Secret Storage. */
interface StoredAuth {
    tokens?: OAuthTokens;
    /** The client Nova registered itself (dynamic client registration). */
    client?: OAuthClientInformationMixed;
    verifier?: string;
    discovery?: OAuthDiscoveryState;
    redirectUrl?: string;
}

/** The server wants the user to sign in; only Connect in Nova AI: MCP Servers can do that. */
export class NeedsAuthError extends Error {
    public constructor(server: string) {
        super(`MCP server "${server}" needs you to sign in. Run Nova AI: MCP Servers and choose Connect.`);
    }
}

/**
 * The SDK's OAuth client for one server: discovery (RFC 9728 / 8414), dynamic client
 * registration, PKCE and refresh all happen in the SDK's `auth()`. Adapted from
 * nova-ai-next's `buildMcpOAuthProvider`, but tokens live in Secret Storage and the
 * redirect is a loopback address (RFC 8252), which authorization servers accept from
 * native apps. Call `load()` before handing it to a transport.
 */
export class SecretOAuthProvider implements OAuthClientProvider {
    private stored: StoredAuth = {};
    private expectedState?: string;
    /** Set while the user connects: the loopback redirect and how to open the browser. */
    private interactive?: { redirectUrl: string; open(url: URL): Promise<void> };

    public constructor(
        private readonly secrets: SecretStore,
        private readonly key: string,
        private readonly server: string,
        private readonly config: McpOAuthConfig = {}
    ) {
    }

    public async load(): Promise<void> {
        try {
            this.stored = JSON.parse(await this.secrets.get(this.key) ?? '{}') as StoredAuth;
        } catch {
            this.stored = {};
        }
    }

    public get hasTokens(): boolean {
        return !!this.stored.tokens;
    }

    public get redirectUrl(): string | undefined {
        return this.interactive?.redirectUrl ?? this.stored.redirectUrl;
    }

    public get clientMetadata(): OAuthClientMetadata {
        return {
            redirect_uris: this.redirectUrl ? [this.redirectUrl] : [],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
            client_name: 'Nova AI for VS Code',
            ...(this.config.scope ? { scope: this.config.scope } : {})
        };
    }

    public state(): string {
        this.expectedState = randomUUID();
        return this.expectedState;
    }

    public isExpectedState(state: string | null): boolean {
        return !!this.expectedState && state === this.expectedState;
    }

    public clientInformation(): OAuthClientInformationMixed | undefined {
        if (this.config.clientId) {
            return { client_id: this.config.clientId, ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}) };
        }
        // A registered client is bound to its redirect; a new loopback port needs a new registration.
        const client = this.stored.client as { redirect_uris?: string[] } | undefined;
        if (this.interactive && client?.redirect_uris && !client.redirect_uris.includes(this.interactive.redirectUrl)) {
            return undefined;
        }
        // Outside Connect there is no redirect to register a client for: the user has to sign in.
        if (!this.interactive && !this.stored.client) {
            throw new NeedsAuthError(this.server);
        }
        return this.stored.client;
    }

    public async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
        await this.save({ client });
    }

    public tokens(): OAuthTokens | undefined {
        return this.stored.tokens;
    }

    public async saveTokens(tokens: OAuthTokens): Promise<void> {
        await this.save({ tokens });
    }

    public async redirectToAuthorization(url: URL): Promise<void> {
        if (!this.interactive) {
            throw new NeedsAuthError(this.server);
        }
        await this.interactive.open(url);
    }

    public async saveCodeVerifier(verifier: string): Promise<void> {
        await this.save({ verifier });
    }

    public codeVerifier(): string {
        if (!this.stored.verifier) {
            throw new Error('No sign-in is in progress for this MCP server.');
        }
        return this.stored.verifier;
    }

    public discoveryState(): OAuthDiscoveryState | undefined {
        return this.stored.discovery;
    }

    public async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
        await this.save({ discovery });
    }

    public async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
        if (scope === 'all') {
            this.stored = {};
            await this.secrets.delete(this.key);
            return;
        }
        const field = scope === 'client' ? 'client' : scope === 'tokens' ? 'tokens' : scope === 'verifier' ? 'verifier' : 'discovery';
        await this.save({ [field]: undefined });
    }

    /** Signs out: forgets the tokens and the registered client. */
    public async forget(): Promise<void> {
        await this.invalidateCredentials('all');
    }

    /**
     * Signs in through the browser: a one-off server on 127.0.0.1 receives the redirect.
     * `external` maps the loopback address for remote windows (vscode.env.asExternalUri).
     */
    public async authorize(serverUrl: string, options: {
        open(url: URL): Promise<void>;
        external?(local: string): Promise<string>;
        signal?: AbortSignal;
    }): Promise<void> {
        const callback = await listenForCallback(this.config.callbackPort ?? 0, (state) => this.isExpectedState(state));
        try {
            const local = `http://127.0.0.1:${callback.port}/callback`;
            const redirectUrl = options.external ? await options.external(local) : local;
            this.interactive = { redirectUrl, open: options.open };
            await this.save({ redirectUrl });

            if (await auth(this, { serverUrl, scope: this.config.scope }) === 'AUTHORIZED') {
                return;
            }
            const code = await callback.code(options.signal);
            await auth(this, { serverUrl, scope: this.config.scope, authorizationCode: code });
        } finally {
            this.interactive = undefined;
            this.expectedState = undefined;
            callback.close();
        }
    }

    private async save(change: Partial<StoredAuth>): Promise<void> {
        this.stored = { ...this.stored, ...change };
        await this.secrets.store(this.key, JSON.stringify(this.stored));
    }
}

interface Callback {
    port: number;
    /** The authorization code of the first redirect whose `state` checks out. */
    code(signal?: AbortSignal): Promise<string>;
    close(): void;
}

/** A one-off server on 127.0.0.1 for the redirect; it checks `state` from the start, as a fast browser can come back before `auth()` returns. */
async function listenForCallback(port: number, checkState: (state: string | null) => boolean): Promise<Callback> {
    let settle!: (result: { code?: string; error?: string }) => void;
    const redirected = new Promise<{ code?: string; error?: string }>((resolve) => settle = resolve);
    const server: Server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
        const valid = checkState(url.searchParams.get('state'));
        const ok = valid && !!code && !error;
        response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(`<!doctype html><title>Nova AI</title><p>${ok ? 'Signed in. You can close this tab and return to VS Code.' : 'Sign-in failed. Return to VS Code and try again.'}</p>`);
        if (valid) {
            settle(ok ? { code: code! } : { error: error ?? 'No authorization code was returned.' });
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    return {
        port: (server.address() as AddressInfo).port,
        code: (signal) => new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Sign-in timed out.')), AUTHORIZE_TIMEOUT_MS);
            signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Sign-in was cancelled.'));
            });
            void redirected.then((result) => {
                clearTimeout(timer);
                result.code ? resolve(result.code) : reject(new Error(`Sign-in failed: ${result.error}`));
            });
        }),
        close: () => server.close()
    };
}
