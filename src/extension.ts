import * as vscode from 'vscode';
import {
    COMMAND_MANAGE,
    COMMAND_ADD_SELECTION,
    COMMAND_CLEAN_UP_PROJECTS,
    COMMAND_OPEN_GLOBAL_MEMORY,
    COMMAND_OPEN_PROJECT_MEMORY,
    COMMAND_REVEAL_HOME,
    COMMAND_SHOW_ACCOUNT,
    COMMAND_CHAT_DELETE,
    COMMAND_CHAT_OPEN_IN_EDITOR,
    COMMAND_CHAT_RENAME,
    COMMAND_MANAGE_SKILLS,
    COMMAND_SHOW_HELP,
    COMMAND_SEARCH_CHATS,
    COMMAND_SHOW_HISTORY,
    COMMAND_FOCUS_CHAT,
    COMMAND_MANAGE_MODELS,
    COMMAND_NEW_CHAT,
    COMMAND_OPEN_CHAT,
    COMMAND_OPEN_CHAT_IN_EDITOR,
    COMMAND_OPEN_SETTINGS,
    COMMAND_REFRESH_MODELS,
    COMMAND_SIGN_IN,
    COMMAND_SIGN_OUT,
    CONTEXT_SIGNED_IN,
    NOVA_SIDEBAR_VIEW_ID,
    NOVA_VENDOR,
    NOVA_VIEW_CONTAINER_ID
} from './core/constants';
import {isProposalEnabled} from './core/apiSupport';
import {Diagnostics} from './core/diagnostics';
import {ModelProvider} from './model/modelProvider';
import {SessionService} from './services/SessionService';
import {toUserMessage} from './core/errors';
import type {LanguageModelInfo} from './core/types';
import {StatusBar} from './status/StatusBar';
import {CHAT_PANEL_VIEW_TYPE, SKILLS_VIEW_TYPE, ViewProvider, type SignInResult} from './views';
import type {SkillPaths} from './skills/SkillService';
import * as os from 'node:os';
import {registerAgentParticipant} from './chat/AgentParticipant';
import {registerVsCodeTools} from './agent/tools/vscodeTools';
import {registerBrowserSetup} from './browser/BrowserSetup';
import {openHelp} from './core/help';
import {ChatController} from './panel/ChatController';
import {PROPOSED_SCHEME, ProposedContentProvider} from './panel/ProposedContentProvider';
import {SessionStore} from './panel/SessionStore';
import {confirmAndDeleteChats, promptRenameChat, searchChats} from './panel/chatSearch';
import {ChatHub} from './panel/ChatHub';
import * as path from 'node:path';
import {MemoryService, type MemoryScope} from './memory/MemoryService';
import {PermissionService} from './permissions/PermissionService';
import {setScratchRoot} from './agent/tools/workspacePaths';
import {currentWorkspace, ensureDir, NovaHome, pruneOlderThan, type ProjectPaths, workspaceKey} from './storage/NovaHome';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const diagnostics = new Diagnostics();
    diagnostics.info('Nova API proposals enabled by VS Code.', ['chatParticipantAdditions', 'chatProvider', 'languageModelThinkingPart', 'languageModelSystem', 'languageModelPricing']
        .filter(isProposalEnabled));
    const sessionService = new SessionService(context, diagnostics);
    const statusBar = new StatusBar();
    const modelProvider = new ModelProvider(sessionService, diagnostics, statusBar);
    const sidebarProvider = new ViewProvider(context.extensionUri, sessionService, modelProvider, diagnostics);

    const nova = await openNovaHome(context, diagnostics);
    const memory = new MemoryService({ global: nova.home.globalMemory, project: nova.project.memory });
    const permissions = new PermissionService(
        path.join(nova.home.root, 'settings.json'),
        undefined,
        undefined,
        () => nova.project.settings
    );

    const proposedContent = new ProposedContentProvider();
    // Skill folders and settings (docs/NOVA_HOME.md, "Skills"), read fresh on every use.
    const skillPaths = (): SkillPaths => ({
        home: os.homedir(),
        novaHome: nova.home.root,
        projectSettings: nova.project.settings,
        workspaceRoots: (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath)
    });
    sidebarProvider.useSkills(skillPaths);
    const chatHub = new ChatHub();
    // One controller per chat surface (the sidebar, each editor tab), all sharing the store.
    sidebarProvider.useChats((post, options) => {
        const controller = new ChatController(
            modelProvider,
            nova.sessions,
            context.workspaceState,
            proposedContent,
            diagnostics,
            post,
            { memory, permissions, skillPaths },
            { ...options, hub: chatHub }
        );
        chatHub.add(controller);
        return controller;
    });
    /** A chat from a row of the Chats page's context menu (`data-vscode-context`). */
    const chatFromMenu = (context?: { sessionId?: unknown }) => typeof context?.sessionId === 'string'
        ? sidebarProvider.sidebar.listSessions().find((chat) => chat.id === context.sessionId)
        : undefined;

    registerAgentParticipant(context, memory);

    context.subscriptions.push(
        diagnostics,
        statusBar,
        sessionService.onDidChangeSession(() => void refreshStatusBar(sessionService, modelProvider, statusBar)),
        vscode.lm.registerLanguageModelChatProvider(NOVA_VENDOR, modelProvider),
        registerVsCodeTools(memory),
        registerBrowserSetup(context, diagnostics, () => NovaHome.resolve().root),
        vscode.commands.registerCommand(COMMAND_OPEN_GLOBAL_MEMORY, async () => openMemoryFile(memory, 'global')),
        vscode.commands.registerCommand(COMMAND_OPEN_PROJECT_MEMORY, async () => openMemoryFile(memory, 'project')),
        vscode.commands.registerCommand(COMMAND_REVEAL_HOME, async () => {
            await ensureDir(nova.project.dir);
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(nova.project.dir));
        }),
        vscode.commands.registerCommand(COMMAND_CLEAN_UP_PROJECTS, async () => cleanUpProjects(nova.home)),
        proposedContent,
        sidebarProvider,
        chatHub,
        vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposedContent),
        vscode.commands.registerCommand(COMMAND_NEW_CHAT, async () => {
            await focusSidebar(sidebarProvider);
            await sidebarProvider.showInSidebar('chat');
            await sidebarProvider.sidebar.newChat();
        }),
        vscode.commands.registerCommand(COMMAND_ADD_SELECTION, async () => {
            // Into the chat used last: an editor tab, or the sidebar.
            const target = sidebarProvider.activeChat();
            await target.controller.addSelection();
            await target.reveal();
        }),
        vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, sidebarProvider),
        vscode.window.registerWebviewPanelSerializer(SKILLS_VIEW_TYPE, sidebarProvider.skillsSerializer),
        vscode.commands.registerCommand(COMMAND_MANAGE_SKILLS, async () => {
            await sidebarProvider.openSkills();
        }),
        vscode.commands.registerCommand(COMMAND_SHOW_HELP, async () => {
            await openHelp(context.extensionUri);
        }),
        vscode.commands.registerCommand(COMMAND_OPEN_CHAT_IN_EDITOR, async () => {
            await sidebarProvider.openInEditor();
        }),
        vscode.commands.registerCommand(COMMAND_SHOW_HISTORY, async () => {
            await focusSidebar(sidebarProvider);
            await sidebarProvider.showInSidebar('history');
        }),
        vscode.commands.registerCommand(COMMAND_SEARCH_CHATS, async () => {
            const target = sidebarProvider.activeChat();
            await searchChats(target.controller, target.reveal);
        }),
        vscode.commands.registerCommand(COMMAND_CHAT_OPEN_IN_EDITOR, async (context?: { sessionId?: unknown }) => {
            const chat = chatFromMenu(context);
            if (chat) {
                await sidebarProvider.openChatInEditor(chat.id);
            }
        }),
        vscode.commands.registerCommand(COMMAND_CHAT_RENAME, async (context?: { sessionId?: unknown }) => {
            const chat = chatFromMenu(context);
            if (chat) {
                await promptRenameChat(sidebarProvider.sidebar, chat);
            }
        }),
        vscode.commands.registerCommand(COMMAND_CHAT_DELETE, async (context?: { sessionId?: unknown }) => {
            const chat = chatFromMenu(context);
            if (chat) {
                await confirmAndDeleteChats(sidebarProvider.sidebar, [chat.id]);
            }
        }),
        vscode.commands.registerCommand(COMMAND_SHOW_ACCOUNT, async () => {
            await focusSidebar(sidebarProvider);
            await sidebarProvider.showInSidebar('account');
        }),
        vscode.commands.registerCommand(COMMAND_FOCUS_CHAT, async () => {
            await focusSidebar(sidebarProvider);
        }),
        vscode.window.registerWebviewViewProvider(NOVA_SIDEBAR_VIEW_ID, sidebarProvider),
        vscode.commands.registerCommand(COMMAND_MANAGE, async () => {
            await focusSidebar(sidebarProvider);
        }),
        vscode.commands.registerCommand(COMMAND_SIGN_IN, async (prefilledApiKey?: string): Promise<SignInResult> => {
            const fromSidebar = typeof prefilledApiKey === 'string';
            const apiKey = (fromSidebar ? prefilledApiKey : await vscode.window.showInputBox({
                ignoreFocusOut: true,
                password: true,
                prompt: 'Enter your Nova AI API key'
            }))?.trim();

            if (!apiKey) {
                return {ok: false, error: fromSidebar ? 'Enter an API key.' : undefined};
            }

            try {
                await sessionService.signIn(apiKey);
                await modelProvider.refreshModels();
                await sidebarProvider.refresh();
                await refreshStatusBar(sessionService, modelProvider, statusBar);
                void vscode.window.showInformationMessage('Nova AI connected.');
                return {ok: true};
            } catch (error) {
                diagnostics.error('Nova sign-in failed.', error);
                // The sidebar shows the error inline; only toast for the command palette flow.
                if (!fromSidebar) {
                    void vscode.window.showErrorMessage(toUserMessage(error));
                }
                return {ok: false, error: toUserMessage(error)};
            }
        }),
        vscode.commands.registerCommand(COMMAND_SIGN_OUT, async () => {
            await sessionService.signOut();
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
        vscode.commands.registerCommand(COMMAND_OPEN_CHAT, async (options?: ChatOpenOptions) => {
            try {
                const prepared = await prepareChatModel(sessionService, modelProvider);
                if (!prepared) {
                    await focusSidebar(sidebarProvider);
                    void vscode.window.showWarningMessage('Connect Nova AI before opening Chat with Nova models.');
                    return;
                }

                await refreshStatusBar(sessionService, modelProvider, statusBar);
                await openChatView(options);
            } catch (error) {
                diagnostics.error('Nova chat open failed.', error);
                void vscode.window.showErrorMessage(toUserMessage(error));
            }
        }),
        vscode.commands.registerCommand(COMMAND_MANAGE_MODELS, async () => {
            // Opens VS Code's Language Models editor where Nova models can be shown or hidden.
            try {
                await vscode.commands.executeCommand('workbench.action.chat.manage');
            } catch {
                await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
            }
        }),
        vscode.commands.registerCommand(COMMAND_OPEN_SETTINGS, async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:datalabrotterdam.nova-ai-vscode');
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!['nova.developer.parseModelCapabilities', 'nova.models.editTools', 'nova.context.defaultContextWindow'].some((key) => event.affectsConfiguration(key))) {
                return;
            }

            try {
                await modelProvider.refreshModels();
                await refreshStatusBar(sessionService, modelProvider, statusBar);
            } catch (error) {
                diagnostics.error('Nova model capability refresh failed.', error);
            }
        })
    );

    await sessionService.validateExistingSession();
    await modelProvider.warmup();
    await refreshStatusBar(sessionService, modelProvider, statusBar);
}

export function deactivate(): void {
}

/**
 * Opens `~/.nova-ai` for this workspace: project folder, scratch sandbox (pruned after
 * 7 days) and chat sessions (migrated once from VS Code's workspace storage).
 */
async function openNovaHome(context: vscode.ExtensionContext, diagnostics: Diagnostics): Promise<{ home: NovaHome; project: ProjectPaths; sessions: SessionStore }> {
    const home = NovaHome.resolve();
    const workspace = currentWorkspace();
    const project = home.project(workspace ? await workspaceKey(workspace) : 'no-workspace');

    try {
        await home.migrateGlobalMemory();
        if (workspace) {
            await home.ensureProject(project, workspace);
        }
        void pruneOlderThan(project.scratch, 7).catch(() => undefined);
    } catch (error) {
        diagnostics.error(`Nova could not prepare ${project.dir}.`, error);
    }
    setScratchRoot(project.scratch);

    const sessions = await SessionStore.open(project.sessions);
    try {
        const migrated = await sessions.migrateLegacy(context.workspaceState, context.storageUri);
        if (migrated) {
            diagnostics.info(`Moved ${migrated} Nova chats to ${project.sessions}.`);
        }
    } catch (error) {
        diagnostics.error('Moving Nova chats to ~/.nova-ai failed.', error);
    }
    diagnostics.info('Nova home folder.', { root: home.root, project: project.key });
    return { home, project, sessions };
}

async function openMemoryFile(memory: MemoryService, scope: MemoryScope): Promise<void> {
    await memory.ensureFile(scope);
    await vscode.window.showTextDocument(vscode.Uri.file(memory.file(scope)));
}

/** Deletes project folders whose workspace no longer exists, after confirmation. */
async function cleanUpProjects(home: NovaHome): Promise<void> {
    const projects = await home.listProjects();
    const stale: typeof projects = [];
    for (const project of projects) {
        const original = project.info?.path;
        if (!original || /^[a-z][\w+.-]*:\/\//i.test(original)) {
            continue; // unknown or remote: keep
        }
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(original));
        } catch {
            stale.push(project);
        }
    }

    if (!stale.length) {
        void vscode.window.showInformationMessage('Nova AI: no project folders to clean up.');
        return;
    }

    const picked = await vscode.window.showQuickPick(
        stale.map((project) => ({ label: project.info?.name ?? project.key, description: project.info?.path, picked: true, project })),
        { canPickMany: true, placeHolder: 'Delete Nova data (chats, memory, scratch) for these missing workspaces' }
    );
    if (!picked?.length) {
        return;
    }
    for (const { project } of picked) {
        await vscode.workspace.fs.delete(vscode.Uri.file(project.dir), { recursive: true, useTrash: true });
    }
    void vscode.window.showInformationMessage(`Nova AI: moved ${picked.length} project folder(s) to the trash.`);
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

    // Force VS Code to discover the Nova provider models before opening the Chat view.
    await vscode.lm.selectChatModels({vendor: NOVA_VENDOR});

    return true;
}

async function refreshStatusBar(
    sessionService: SessionService,
    modelProvider: ModelProvider,
    statusBar: StatusBar
): Promise<void> {
    const snapshot = await sessionService.getSnapshot();
    statusBar.updateSession(snapshot, await modelProvider.getCachedModels());
    await vscode.commands.executeCommand('setContext', CONTEXT_SIGNED_IN, snapshot.hasApiKey);
}

function getPreferredModel(models: readonly LanguageModelInfo[], selectedModelId?: string): LanguageModelInfo {
    return models.find((model) => model.id === selectedModelId)
        ?? models[0];
}

interface ChatOpenOptions {
    /** Text to put in the chat input, e.g. `@nova `. */
    query?: string;
    mode?: 'ask' | 'agent';
}

async function openChatView(options: ChatOpenOptions = {}): Promise<void> {
    const args = options.query || options.mode
        ? {query: options.query ?? '', isPartialQuery: true, ...(options.mode ? {mode: options.mode} : {})}
        : undefined;

    for (const command of ['workbench.action.chat.open', 'workbench.action.chat.newChat', 'workbench.panel.chat.view.copilot.focus']) {
        try {
            await vscode.commands.executeCommand(command, ...(command === 'workbench.action.chat.open' && args ? [args] : []));
            return;
        } catch {
            continue;
        }
    }

    void vscode.window.showWarningMessage('Unable to open the VS Code chat view from this version of VS Code.');
}
