import * as vscode from 'vscode';
import { ChatService } from './chat/ChatService';
import {
    COMMAND_MANAGE,
    COMMAND_OPEN_CHAT,
    COMMAND_OPEN_SETTINGS,
    COMMAND_REFRESH_MODELS,
    COMMAND_SIGN_IN,
    COMMAND_SIGN_OUT,
    NOVA_SIDEBAR_VIEW_ID,
    NOVA_VENDOR,
    NOVA_VIEW_CONTAINER_ID
} from './core/constants';
import {Diagnostics} from './core/diagnostics';
import {ModelProvider} from './model/modelProvider';
import {SessionService} from './services/SessionService';
import {toUserMessage} from './core/errors';
import type {LanguageModelInfo} from './core/types';
import {StatusBar} from './status/StatusBar';
import { registerWorkspaceTools } from './tools/workspaceTools';
import {ViewProvider} from './views';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const diagnostics = new Diagnostics();
    const sessionService = new SessionService(context, diagnostics);
    const statusBar = new StatusBar();
    const modelProvider = new ModelProvider(sessionService, diagnostics, statusBar);
    const chatService = new ChatService(context, sessionService, diagnostics);
    const sidebarProvider = new ViewProvider(context.extensionUri, sessionService, modelProvider, chatService, diagnostics);

    context.subscriptions.push(
        diagnostics,
        statusBar,
        ...registerWorkspaceTools(),
        sessionService.onDidChangeSession(() => void refreshStatusBar(sessionService, modelProvider, statusBar)),
        vscode.lm.registerLanguageModelChatProvider(NOVA_VENDOR, modelProvider),
        vscode.window.registerWebviewViewProvider(NOVA_SIDEBAR_VIEW_ID, sidebarProvider),
        vscode.commands.registerCommand(COMMAND_MANAGE, async () => {
            await focusSidebar(sidebarProvider);
        }),
        vscode.commands.registerCommand(COMMAND_SIGN_IN, async (prefilledApiKey?: string) => {
            const apiKey = (typeof prefilledApiKey === 'string' ? prefilledApiKey : await vscode.window.showInputBox({
                ignoreFocusOut: true,
                password: true,
                prompt: 'Enter your Nova AI API key'
            }))?.trim();

            if (!apiKey) {
                return;
            }

            try {
                await sessionService.signIn(apiKey);
                await modelProvider.refreshModels();
                await sidebarProvider.refresh();
                await refreshStatusBar(sessionService, modelProvider, statusBar);
                void vscode.window.showInformationMessage('Nova AI connected.');
            } catch (error) {
                diagnostics.error('Nova sign-in failed.', error);
                void vscode.window.showErrorMessage(toUserMessage(error));
            }
        }),
        vscode.commands.registerCommand(COMMAND_SIGN_OUT, async () => {
            await sessionService.signOut();
            await chatService.clear();
            await sidebarProvider.refresh();
            await refreshStatusBar(sessionService, modelProvider, statusBar);
            void vscode.window.showInformationMessage('Nova AI signed out.');
        }),
        vscode.commands.registerCommand(COMMAND_REFRESH_MODELS, async () => {
            try {
                const models = await modelProvider.refreshModels();
                await sidebarProvider.refresh();
                await refreshStatusBar(sessionService, modelProvider, statusBar);
                void vscode.window.showInformationMessage(`Nova AI refreshed ${models.length} models.`);
            } catch (error) {
                diagnostics.error('Nova model refresh failed.', error);
                void vscode.window.showErrorMessage(toUserMessage(error));
            }
        }),
        vscode.commands.registerCommand(COMMAND_OPEN_CHAT, async () => {
            try {
                const prepared = await prepareChatModel(sessionService, modelProvider);
                if (!prepared) {
                    await focusSidebar(sidebarProvider);
                    void vscode.window.showWarningMessage('Connect Nova AI before opening Nova Chat.');
                    return;
                }

                await refreshStatusBar(sessionService, modelProvider, statusBar);
                await focusSidebar(sidebarProvider);
            } catch (error) {
                diagnostics.error('Nova chat open failed.', error);
                void vscode.window.showErrorMessage(toUserMessage(error));
            }
        }),
        vscode.commands.registerCommand(COMMAND_OPEN_SETTINGS, async (query?: string) => {
            await vscode.commands.executeCommand('workbench.action.openSettings', query ?? '@ext:datalabrotterdam.nova-ai-vscode');
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            const affectsModels = event.affectsConfiguration('nova.developer.parseModelCapabilities');
            const affectsAgents = event.affectsConfiguration('nova.chat.customAgents');
            if (!affectsModels && !affectsAgents) {
                return;
            }

            try {
                if (affectsModels) {
                    await modelProvider.refreshModels();
                    await refreshStatusBar(sessionService, modelProvider, statusBar);
                }
                if (affectsAgents) {
                    await sidebarProvider.refresh();
                }
            } catch (error) {
                diagnostics.error('Nova configuration refresh failed.', error);
            }
        })
    );

    await chatService.initialize();
    await sessionService.validateExistingSession();
    await modelProvider.warmup();
    await refreshStatusBar(sessionService, modelProvider, statusBar);
}

export function deactivate(): void {
}

async function focusSidebar(sidebarProvider: ViewProvider): Promise<void> {
    for (const command of [`workbench.view.extension.${NOVA_VIEW_CONTAINER_ID}`, `${NOVA_SIDEBAR_VIEW_ID}.focus`]) {
        try {
            await vscode.commands.executeCommand(command);
        } catch {
        }
    }

    await sidebarProvider.refresh();
}

async function prepareChatModel(
    sessionService: SessionService,
    modelProvider: ModelProvider
): Promise<boolean> {
    if (!(await sessionService.isSignedIn())) {
        return false;
    }

    const models = await modelProvider.refreshModels();
    if (!models.length) {
        void vscode.window.showWarningMessage('Nova AI did not return any available chat models.');
        return false;
    }

    const preferredModel = getPreferredModel(models, (await sessionService.getSnapshot()).selectedModelId);
    await sessionService.setSelectedModel(preferredModel.id);

    return true;
}

async function refreshStatusBar(
    sessionService: SessionService,
    modelProvider: ModelProvider,
    statusBar: StatusBar
): Promise<void> {
    statusBar.updateSession(await sessionService.getSnapshot(), await modelProvider.getCachedModels());
}

function getPreferredModel(models: readonly LanguageModelInfo[], selectedModelId?: string): LanguageModelInfo {
    return models.find((model) => model.id === selectedModelId)
        ?? models[0];
}
