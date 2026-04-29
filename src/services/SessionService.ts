import * as vscode from 'vscode';
import {NovaAI} from '@datalabrotterdam/nova-sdk';
import {
    SECRET_API_KEY,
    STATE_ACCOUNT_SUMMARY,
    STATE_CONNECTION_HEALTH,
    STATE_LAST_ERROR,
    STATE_SELECTED_MODEL,
    STATE_TOOL_CALLING_SUPPORT
} from '../core/constants';
import {Diagnostics} from '../core/diagnostics';
import {toUserMessage} from '../core/errors';
import type {ConnectionHealth, AccountSummary, SessionSnapshot, ToolCallingSupport} from '../core/types';

export class SessionService {
    private readonly didChangeSessionEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeSession = this.didChangeSessionEmitter.event;

    public constructor(
        private readonly context: Pick<vscode.ExtensionContext, 'secrets' | 'globalState'>,
        private readonly diagnostics: Diagnostics
    ) {

    }

    public async getSnapshot(): Promise<SessionSnapshot> {
        return {
            hasApiKey: Boolean(await this.getApiKey()),
            accountSummary: this.context.globalState.get<AccountSummary>(STATE_ACCOUNT_SUMMARY),
            connectionHealth: this.context.globalState.get<ConnectionHealth>(STATE_CONNECTION_HEALTH, 'signedOut'),
            lastError: this.context.globalState.get<string | undefined>(STATE_LAST_ERROR),
            selectedModelId: this.context.globalState.get<string | undefined>(STATE_SELECTED_MODEL),
            toolCallingSupport: this.context.globalState.get<ToolCallingSupport>(STATE_TOOL_CALLING_SUPPORT, 'unknown')
        };
    }

    public async getApiKey(): Promise<string | undefined> {
        return this.context.secrets.get(SECRET_API_KEY);
    }

    public async isSignedIn(): Promise<boolean> {
        return Boolean(await this.getApiKey());
    }

    public async createClient(): Promise<NovaAI | undefined> {
        const apiKey = await this.getApiKey();
        return apiKey ? new NovaAI({apiKey}) : undefined;
    }

    public async signIn(apiKey: string): Promise<SessionSnapshot> {
        const client = new NovaAI({apiKey: apiKey.trim()});
        const accountSummary = await this.fetchAccountSummary(client);

        await this.context.secrets.store(SECRET_API_KEY, apiKey.trim());
        await this.context.globalState.update(STATE_ACCOUNT_SUMMARY, accountSummary);
        await this.context.globalState.update(STATE_CONNECTION_HEALTH, 'connected');
        await this.context.globalState.update(STATE_LAST_ERROR, undefined);
        await this.context.globalState.update(STATE_TOOL_CALLING_SUPPORT, 'unknown');

        this.didChangeSessionEmitter.fire();
        return this.getSnapshot();
    }

    public async validateExistingSession(): Promise<SessionSnapshot> {
        const client = await this.createClient();
        if (!client) {
            await this.context.globalState.update(STATE_ACCOUNT_SUMMARY, undefined);
            await this.context.globalState.update(STATE_CONNECTION_HEALTH, 'signedOut');
            await this.context.globalState.update(STATE_LAST_ERROR, undefined);
            this.didChangeSessionEmitter.fire();
            return this.getSnapshot();
        }

        try {
            const accountSummary = await this.fetchAccountSummary(client);
            await this.context.globalState.update(STATE_ACCOUNT_SUMMARY, accountSummary);
            await this.context.globalState.update(STATE_CONNECTION_HEALTH, 'connected');
            await this.context.globalState.update(STATE_LAST_ERROR, undefined);
        } catch (error) {
            this.diagnostics.error('Nova session validation failed.', error);
            await this.context.globalState.update(STATE_CONNECTION_HEALTH, 'degraded');
            await this.context.globalState.update(STATE_LAST_ERROR, toUserMessage(error));
        }

        this.didChangeSessionEmitter.fire();
        return this.getSnapshot();
    }

    public async signOut(): Promise<void> {
        await this.context.secrets.delete(SECRET_API_KEY);
        await this.context.globalState.update(STATE_ACCOUNT_SUMMARY, undefined);
        await this.context.globalState.update(STATE_CONNECTION_HEALTH, 'signedOut');
        await this.context.globalState.update(STATE_LAST_ERROR, undefined);
        await this.context.globalState.update(STATE_SELECTED_MODEL, undefined);
        await this.context.globalState.update(STATE_TOOL_CALLING_SUPPORT, 'unknown');
        this.didChangeSessionEmitter.fire();
    }

    public async setSelectedModel(modelId: string | undefined): Promise<void> {
        await this.context.globalState.update(STATE_SELECTED_MODEL, modelId);
        this.didChangeSessionEmitter.fire();
    }

    public async setToolCallingSupport(value: ToolCallingSupport): Promise<void> {
        await this.context.globalState.update(STATE_TOOL_CALLING_SUPPORT, value);
        this.didChangeSessionEmitter.fire();
    }

    private async fetchAccountSummary(client: NovaAI): Promise<AccountSummary> {
        const [providers, models] = await Promise.all([
            client.providers.list(),
            client.models.list({limit: 20})
        ]);

        return {
            providerNames: providers.data.map((provider) => provider.name),
            modelCount: models.data.length,
            validatedAt: new Date().toISOString(),
            baseUrl: client.baseUrl
        };
    }
}
