import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commands, Disposable, ThemeIcon, Uri, ViewColumn, Webview, WebviewPanel, WebviewPanelSerializer, WebviewView, WebviewViewProvider, window } from 'vscode';
import type { AgentsCommand } from '../agents/protocol';
import type { AgentPaths } from '../agents/AgentService';
import { AgentsController } from '../agents/AgentsController';
import type { SkillsCommand } from '../skills/protocol';
import type { SkillPaths } from '../skills/SkillService';
import { SkillsController } from '../skills/SkillsController';
import type { CustomizeSection } from './sections';
import type { McpCommand } from '../mcp/protocol';
import type { McpController } from '../mcp/McpController';
import type { ToolsCommand } from '../tools/protocol';
import type { ToolsController } from '../tools/ToolsController';
import type { HooksCommand } from '../hooks/protocol';
import type { HooksController } from '../hooks/HooksController';
import { SettingsController } from '../settings/SettingsController';
import type { SettingsCommand } from '../settings/protocol';
import { Diagnostics } from '../core/diagnostics';
import {
  COMMAND_MANAGE_MODELS,
  COMMAND_OPEN_CHAT,
  COMMAND_OPEN_GLOBAL_MEMORY,
  COMMAND_OPEN_PROJECT_MEMORY,
  COMMAND_REVEAL_HOME,
  COMMAND_OPEN_SETTINGS,
  COMMAND_REFRESH_MODELS,
  COMMAND_SIGN_IN,
  COMMAND_SIGN_OUT,
  NOVA_SECONDARY_VIEW_ID,
  NOVA_SIDEBAR_VIEW_ID,
  NOVA_VIEW_CONTAINER_ID
} from '../core/constants';
import { toUserMessage } from '../core/errors';
import type { LanguageModelInfo, ProfileView, SessionSnapshot } from '../core/types';
import { ProfileService } from '../services/ProfileService';
import { ModelProvider, pricingLabel } from '../model/modelProvider';
import type { ChatController, ChatControllerOptions } from '../panel/ChatController';
import type { ChatCommand, ChatEvent } from '../panel/protocol';
import { SessionService } from '../services/SessionService';
import { Manifest, Resource } from './svelte';
import type { SyntaxColors } from './syntaxColors';
import { loadSyntaxColors, onDidChangeSyntaxTheme } from './syntaxTheme';

const WEBVIEW_ENTRY = 'webview/index.html' as const;
const HEAD_MARKER = '<!--nova:svelte-head-->';
const BODY_MARKER = '<!--nova:svelte-body-->';

export type { CustomizeSection };
export type Surface = 'sidebar' | 'editor' | 'customize';
export const CUSTOMIZE_VIEW_TYPE = 'nova.customize';
/** Tabs of earlier versions; they reopen as the Customizations page. */
export const SETTINGS_VIEW_TYPE = 'nova.settings';

export const CHAT_PANEL_VIEW_TYPE = 'nova.chatPanel';
export const SKILLS_VIEW_TYPE = 'nova.skills';
export const AGENTS_VIEW_TYPE = 'nova.agents';

export type ChatFactory = (post: (event: ChatEvent) => void, options: ChatControllerOptions) => ChatController;

/**
 * Hosts the Nova UI in the sidebar views and in editor tabs. Each sidebar (left and right) shows
 * one chat at a time; every editor tab has a chat of its own (its own controller), so several chats
 * can be open, and running, side by side. A chat is open in one place only (see ChatHub).
 */
export class ViewProvider implements WebviewViewProvider, WebviewPanelSerializer, Disposable {
  /** The sidebar view in use: left or right. */
  private view?: WebviewView;
  private readonly views = new Set<WebviewView>();
  /** Each sidebar view (left, right) has a chat of its own, keyed by view id. */
  private readonly sidebarChats = new Map<string, ChatController>();
  private readonly panels = new Map<WebviewPanel, ChatController>();
  /** The editor tab the user used last; undefined: the sidebar. Commands go there. */
  private lastActivePanel?: WebviewPanel;
  private createChat?: ChatFactory;
  private readonly profiles = new ProfileService();
  private skillPaths?: () => SkillPaths;
  private agentPaths?: () => AgentPaths;
  private createMcp?: (post: (message: unknown) => void) => McpController;
  private createTools?: (post: (message: unknown) => void) => ToolsController;
  private createHooks?: (post: (message: unknown) => void) => HooksController;
  private customize?: { panel: WebviewPanel; tools?: ToolsController; mcp?: McpController; hooks?: HooksController; skills: SkillsController; agents: AgentsController; settings: SettingsController };
  /** The section to show when the page is ready. */
  private pendingSection?: CustomizeSection;
  private createSettings?: (post: (message: unknown) => void) => SettingsController;

  public constructor(
    private readonly extensionUri: Uri,
    private readonly sessionService: SessionService,
    private readonly modelProvider: ModelProvider,
    private readonly diagnostics: Diagnostics
  ) {
    this.sessionService.onDidChangeSession(() => void this.refresh());
    this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refresh());
    // Code in answers uses the editor theme's token colors, so a theme change reaches every surface.
    onDidChangeSyntaxTheme(() => void this.refresh());
  }

  /** Sets how chats are created and creates the sidebar's. */
  public useChats(createChat: ChatFactory): void {
    this.createChat = createChat;
    // Only the left sidebar reopens the last chat after a reload; the right one starts empty.
    this.sidebarChats.set(NOVA_SIDEBAR_VIEW_ID, this.newSidebarChat(NOVA_SIDEBAR_VIEW_ID, undefined));
    this.sidebarChats.set(NOVA_SECONDARY_VIEW_ID, this.newSidebarChat(NOVA_SECONDARY_VIEW_ID, null));
  }

  /** The id of the sidebar view in use. */
  private get slot(): string {
    return this.view?.viewType ?? NOVA_SIDEBAR_VIEW_ID;
  }

  /** The chat of the sidebar view in use. */
  private get sidebarChat(): ChatController | undefined {
    return this.sidebarChats.get(this.slot);
  }

  /** Where skills live, for the Skills page. */
  public useSkills(paths: () => SkillPaths): void {
    this.skillPaths = paths;
  }

  /** Where agents live, for the Agents page. */
  public useAgents(paths: () => AgentPaths): void {
    this.agentPaths = paths;
  }

  /** How to make the Settings page's controller (the extension knows the models and the settings). */
  public useSettings(create: (post: (message: unknown) => void) => SettingsController): void {
    this.createSettings = create;
  }

  /** How to make the MCP Servers section's controller. */
  public useMcp(create: (post: (message: unknown) => void) => McpController): void {
    this.createMcp = create;
  }

  /** How to make the Tools section's controller (the extension knows the tools and the permissions). */
  public useTools(create: (post: (message: unknown) => void) => ToolsController): void {
    this.createTools = create;
  }

  /** How to make the Hooks section's controller (the extension knows the settings files and the tools). */
  public useHooks(create: (post: (message: unknown) => void) => HooksController): void {
    this.createHooks = create;
  }

  /** The Customizations page (one editor tab): skills, agents and settings in one place. */
  public async openCustomize(section?: CustomizeSection): Promise<void> {
    this.pendingSection = section;
    if (this.customize) {
      this.customize.panel.reveal();
      this.showSection();
      return;
    }
    await this.adoptCustomizePanel(window.createWebviewPanel(CUSTOMIZE_VIEW_TYPE, 'Nova Customizations', ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: this.resourceRoots()
    }));
  }

  /** Restores the Customizations tab, or a tab of an earlier version, after a window reload. */
  public readonly customizeSerializer: WebviewPanelSerializer = {
    deserializeWebviewPanel: (panel) => this.adoptCustomizePanel(panel)
  };

  private showSection(): void {
    if (this.customize && this.pendingSection) {
      void postSafely(this.customize.panel.webview, { type: 'customize/section', section: this.pendingSection });
      this.pendingSection = undefined;
    }
  }

  private async adoptCustomizePanel(panel: WebviewPanel): Promise<void> {
    if (!this.createSettings || !this.skillPaths || !this.agentPaths) {
      panel.dispose();
      return;
    }
    if (this.customize) {
      // One page only: a restored duplicate closes.
      panel.dispose();
      return;
    }
    panel.iconPath = new ThemeIcon('settings-gear');
    const post = (message: unknown) => postSafely(panel.webview, message);
    const skills = new SkillsController(this.skillPaths, post);
    const agents = new AgentsController(this.agentPaths, post);
    const settings = this.createSettings(post);
    const tools = this.createTools?.(post);
    const mcp = this.createMcp?.(post);
    const hooks = this.createHooks?.(post);
    this.customize = { panel, tools, mcp, hooks, skills, agents, settings };
    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        skills.refresh();
        agents.refresh();
        void tools?.refresh();
        void hooks?.refresh();
      }
    });
    panel.onDidDispose(() => {
      skills.dispose();
      agents.dispose();
      settings.dispose();
      tools?.dispose();
      mcp?.dispose();
      hooks?.dispose();
      if (this.customize?.panel === panel) {
        this.customize = undefined;
      }
    });
    await this.attach(panel.webview, 'customize');
  }

  /** The sidebar's chat. */
  public get sidebar(): ChatController {
    if (!this.sidebarChat) {
      throw new Error('Nova chats are not set up yet.');
    }
    return this.sidebarChat;
  }

  /** The chat the user used last (an editor tab, else the sidebar) and how to show it. */
  public activeChat(): { controller: ChatController; reveal: () => Promise<void> } {
    const panel = this.lastActivePanel && this.panels.has(this.lastActivePanel) ? this.lastActivePanel : undefined;
    return panel
      ? { controller: this.panels.get(panel)!, reveal: async () => panel.reveal() }
      : { controller: this.sidebar, reveal: () => this.revealSidebar() };
  }

  public dispose(): void {
    for (const [panel, controller] of this.panels) {
      controller.dispose();
      panel.dispose();
    }
    this.panels.clear();
    for (const controller of this.sidebarChats.values()) {
      controller.dispose();
    }
    this.customize?.skills.dispose();
    this.customize?.agents.dispose();
    this.customize?.settings.dispose();
    this.customize?.tools?.dispose();
    this.customize?.mcp?.dispose();
  }

  public async resolveWebviewView(view: WebviewView): Promise<void> {
    this.views.add(view);
    this.view = view;
    view.onDidDispose(() => {
      this.views.delete(view);
      if (this.view === view) {
        this.view = [...this.views][0];
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.view = view;
        void this.refresh();
        // The page may have been rebuilt while hidden: send the chat again.
        void this.sidebarChats.get(view.viewType)?.handle({ command: 'chat/ready' });
      }
    });
    await this.attach(view.webview, 'sidebar');
  }

  /**
   * Makes the sidebar view the user works in the one that menus and toasts address; each view
   * keeps getting the events of its own chat.
   */
  private use(view: WebviewView): void {
    this.view = view;
  }

  /** Shows a sidebar view, left or right (by default the one in use), and puts it in use. */
  public async focusSidebar(viewId = this.view?.viewType ?? NOVA_SIDEBAR_VIEW_ID): Promise<void> {
    try {
      await commands.executeCommand(`${viewId}.focus`);
    } catch {
      await commands.executeCommand(`workbench.view.extension.${NOVA_VIEW_CONTAINER_ID}`);
    }
    // A view opened just now was put in use as VS Code resolved it.
    const view = [...this.views].find((candidate) => candidate.viewType === viewId);
    if (view) {
      this.use(view);
    }
  }

  /** Restores an editor tab after a window reload, with the chat it showed. */
  public async deserializeWebviewPanel(panel: WebviewPanel, state: unknown): Promise<void> {
    const sessionId = (state as { sessionId?: unknown } | undefined)?.sessionId;
    await this.adoptPanel(panel, (post, options) => this.chatFactory()(post, {
      ...options,
      initialSessionId: typeof sessionId === 'string' ? sessionId : null
    }));
  }

  /**
   * "Open in Editor" from the sidebar: its chat moves to a new tab, running reply and all,
   * and the sidebar starts a new chat. An empty sidebar chat just opens a new tab.
   */
  public async openInEditor(slot = this.slot): Promise<void> {
    const moving = this.sidebarChats.get(slot);
    if (!moving) {
      return;
    }
    if (moving.isEmpty) {
      await this.openNewTab(null);
      return;
    }
    const fresh = this.newSidebarChat(slot, null);
    this.sidebarChats.set(slot, fresh);
    await moving.forgetLast();
    await this.adoptPanel(this.createPanel(moving.title), () => moving);
    await fresh.handle({ command: 'chat/ready' });
  }

  /** Opens a chat (or a new one) in an editor tab; a chat open elsewhere is shown there. */
  public async openChatInEditor(sessionId: string): Promise<void> {
    const owner = this.ownerOf(sessionId);
    const slot = [...this.sidebarChats].find(([, controller]) => controller === owner)?.[0];
    if (slot) {
      await this.openInEditor(slot);
    } else if (owner) {
      await owner.reveal();
    } else {
      await this.openNewTab(sessionId);
    }
  }

  public async openNewTab(sessionId: string | null, column: ViewColumn = ViewColumn.Active): Promise<void> {
    await this.adoptPanel(this.createPanel('New chat', column), (post, options) => this.chatFactory()(post, { ...options, initialSessionId: sessionId }));
  }

  /** The editor toolbar's Nova button: a new chat tab, split beside when a chat tab is in front. */
  public async newChatTab(): Promise<void> {
    const chatInFront = [...this.panels.keys()].some((panel) => panel.active);
    await this.openNewTab(null, chatInFront ? ViewColumn.Beside : ViewColumn.Active);
  }

  /** Asks the sidebar webview to show a view (from the VS Code title bar buttons). */
  public async showInSidebar(view: 'history' | 'account' | 'chat'): Promise<void> {
    await this.view?.webview.postMessage({ type: 'ui', action: view });
  }

  public async revealSidebar(): Promise<void> {
    await this.focusSidebar();
    await this.showInSidebar('chat');
  }

  /** Pushes the current session and model state to every surface. */
  public async refresh(): Promise<void> {
    await Promise.all(this.surfaces().map(async ({ webview, surface }) =>
      webview.postMessage({ type: 'state', state: await this.createState(webview, surface) })));
  }

  private chatFactory(): ChatFactory {
    if (!this.createChat) {
      throw new Error('Nova chats are not set up yet.');
    }
    return this.createChat;
  }

  private newSidebarChat(slot: string, initialSessionId: string | null | undefined): ChatController {
    return this.chatFactory()(this.sidebarPost(slot), {
      rememberLast: slot === NOVA_SIDEBAR_VIEW_ID,
      initialSessionId,
      reveal: () => this.revealSlot(slot),
      takeOver: (requester, owner) => this.takeOver(requester, owner)
    });
  }

  /** How a sidebar chat reaches its view. */
  private sidebarPost(slot: string): (event: ChatEvent) => void {
    return (event) => {
      const view = [...this.views].find((candidate) => candidate.viewType === slot);
      if (view) {
        postSafely(view.webview, event);
      }
    };
  }

  /** Shows one sidebar view with its chat. */
  private async revealSlot(slot: string): Promise<void> {
    await this.focusSidebar(slot);
    await this.showInSidebar('chat');
  }

  /**
   * Opening a chat that another place shows moves it to the place that asked, running reply and
   * all. The asking place's own chat (idle; ChatController checks) makes way; a sidebar the
   * chat leaves starts a new chat, an editor tab it leaves closes.
   */
  private async takeOver(requester: ChatController, owner: ChatController): Promise<void> {
    const from = this.placeOf(owner);
    const to = this.placeOf(requester);
    if (!from || !to) {
      await owner.reveal();
      return;
    }
    // Free the old place first, so closing its tab does not stop the moving chat.
    const freshSidebar = typeof from === 'string' ? this.newSidebarChat(from, null) : undefined;
    if (freshSidebar && typeof from === 'string') {
      await owner.forgetLast();
      this.sidebarChats.set(from, freshSidebar);
    } else if (typeof from !== 'string') {
      this.panels.delete(from);
      from.dispose();
    }
    if (typeof to === 'string') {
      this.sidebarChats.set(to, owner);
      owner.moveTo(this.sidebarPost(to), { reveal: () => this.revealSlot(to), onTitle: undefined, rememberLast: to === NOVA_SIDEBAR_VIEW_ID });
    } else {
      const wiring = this.panelWiring(to);
      this.panels.set(to, owner);
      owner.moveTo(wiring.post, { reveal: wiring.reveal, onTitle: wiring.onTitle });
      wiring.onTitle(owner.title);
    }
    requester.dispose();
    await freshSidebar?.handle({ command: 'chat/ready' });
  }

  /** The sidebar view id or the tab a chat is shown in. */
  private placeOf(controller: ChatController): string | WebviewPanel | undefined {
    const slot = [...this.sidebarChats].find(([, candidate]) => candidate === controller)?.[0];
    if (slot) {
      return slot;
    }
    return [...this.panels].find(([, candidate]) => candidate === controller)?.[0];
  }

  /** How a tab's chat reaches it: events, showing the tab, and its title. */
  private panelWiring(panel: WebviewPanel): { post: (event: ChatEvent) => void; reveal: () => void; onTitle: (title: string) => void } {
    return {
      post: (event) => postSafely(panel.webview, event),
      reveal: () => panel.reveal(),
      onTitle: (title) => {
        const next = title || 'New chat';
        if (panel.title !== next) {
          panel.title = next;
        }
      }
    };
  }

  private ownerOf(sessionId: string): ChatController | undefined {
    return [...this.sidebarChats.values(), ...this.panels.values()].find((controller) => controller?.currentSessionId === sessionId);
  }

  private createPanel(title: string, column: ViewColumn = ViewColumn.Active): WebviewPanel {
    return window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, title || 'New chat', column, {
      enableScripts: true,
      localResourceRoots: this.resourceRoots()
    });
  }

  /** Wires a tab to a chat: `chatFor` creates one, or hands over the sidebar's. */
  private async adoptPanel(panel: WebviewPanel, chatFor: ChatFactory): Promise<void> {
    panel.iconPath = {
      light: Uri.joinPath(this.extensionUri, 'resources', 'nova-dark.svg'),
      dark: Uri.joinPath(this.extensionUri, 'resources', 'favicon.svg')
    };
    const { post, reveal, onTitle } = this.panelWiring(panel);
    const controller = chatFor(post, { rememberLast: false, reveal, onTitle, takeOver: (requester, owner) => this.takeOver(requester, owner) });
    if ([...this.sidebarChats.values()].includes(controller) || [...this.panels.values()].includes(controller)) {
      throw new Error('A Nova chat cannot be shown twice.');
    }
    // A chat handed over from the sidebar keeps running; point it at this tab.
    controller.moveTo(post, { reveal, onTitle });
    this.panels.set(panel, controller);
    this.lastActivePanel = panel;
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.lastActivePanel = panel;
      }
    });
    panel.onDidDispose(() => {
      // The tab's chat now: a chat that moved in replaced it; one that moved out is gone from the map.
      const current = this.panels.get(panel);
      this.panels.delete(panel);
      if (this.lastActivePanel === panel) {
        this.lastActivePanel = undefined;
      }
      // A running reply is stopped; what it produced so far is saved.
      current?.dispose();
    });
    onTitle(controller.title);
    await this.attach(panel.webview, 'editor');
  }

  private surfaces(): Array<{ webview: Webview; surface: Surface }> {
    return [
      ...[...this.views].map((view) => ({ webview: view.webview, surface: 'sidebar' as const })),
      ...[...this.panels.keys()].map((panel) => ({ webview: panel.webview, surface: 'editor' as const })),
      ...(this.customize ? [{ webview: this.customize.panel.webview, surface: 'customize' as const }] : [])
    ];
  }

  private chatOf(webview: Webview): ChatController | undefined {
    const view = [...this.views].find((candidate) => candidate.webview === webview);
    if (view) {
      return this.sidebarChats.get(view.viewType);
    }
    for (const [panel, controller] of this.panels) {
      if (panel.webview === webview) {
        return controller;
      }
    }
    return undefined;
  }

  private resourceRoots(): Uri[] {
    return [Uri.joinPath(this.extensionUri, 'out', 'webview'), Uri.joinPath(this.extensionUri, 'resources')];
  }

  private async attach(webview: Webview, surface: Surface): Promise<void> {
    // Give VS Code a policy-carrying document before anything else: setting the options
    // renders the webview, and an empty document triggers the missing-CSP warning.
    webview.html = `<!DOCTYPE html><html><head>${createCspMeta(webview.cspSource, randomUUID())}</head><body></body></html>`;
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
    webview.onDidReceiveMessage((message: SidebarMessage) => void this.handleMessage(message, webview));

    // Render the document once; later state changes are pushed with postMessage so the
    // view does not flicker or lose its local state (form input, scroll position).
    webview.html = await this.renderDocument(webview, surface);
  }

  private async handleMessage(message: SidebarMessage, source: Webview): Promise<void> {
    if (this.customize?.panel.webview === source) {
      await this.handleCustomize(message, this.customize);
      return;
    }
    if (/^(tools|mcp|skills|settings|agents|hooks|customize)\//.test(message.command)) {
      return;
    }
    const sidebarView = [...this.views].find((view) => view.webview === source);
    if (sidebarView) {
      this.use(sidebarView);
    }
    const panel = [...this.panels.keys()].find((candidate) => candidate.webview === source);
    this.lastActivePanel = panel;
    if (message.command.startsWith('chat/')) {
      try {
        await this.chatOf(source)?.handle(message as unknown as ChatCommand);
      } catch (error) {
        this.diagnostics.error('Nova chat action failed.', error);
        void window.showErrorMessage(toUserMessage(error));
      }
      return;
    }

    try {
      switch (message.command) {
        case 'ready':
          await this.refresh();
          break;
        case COMMAND_SIGN_IN: {
          const result = await commands.executeCommand<SignInResult | undefined>(COMMAND_SIGN_IN, message.apiKey);
          await source.postMessage({ type: 'signInResult', ok: result?.ok ?? false, error: result?.error });
          break;
        }
        case COMMAND_OPEN_CHAT:
          await commands.executeCommand(COMMAND_OPEN_CHAT, { query: message.query, mode: message.mode });
          break;
        case 'openInEditor':
          await this.openInEditor();
          break;
        case 'newChatTab':
          await this.openNewTab(null);
          break;
        case 'openChatInEditor':
          if (typeof message.sessionId === 'string') {
            await this.openChatInEditor(message.sessionId);
          }
          break;
        case COMMAND_REFRESH_MODELS:
        case COMMAND_SIGN_OUT:
        case COMMAND_OPEN_SETTINGS:
        case COMMAND_MANAGE_MODELS:
        case COMMAND_OPEN_GLOBAL_MEMORY:
        case COMMAND_OPEN_PROJECT_MEMORY:
        case COMMAND_REVEAL_HOME:
          await commands.executeCommand(message.command);
          break;
        default:
          break;
      }
    } catch (error) {
      this.diagnostics.error('Nova sidebar action failed.', error);
      void window.showErrorMessage(toUserMessage(error));
    }
  }

  private async createState(webview: Webview, surface: Surface): Promise<SidebarRenderState> {
    const snapshot = await this.sessionService.getSnapshot();
    const models = snapshot.hasApiKey ? await this.modelProvider.getCachedModels() : [];
    const resource = (name: string) => webview.asWebviewUri(Uri.joinPath(this.extensionUri, 'resources', name)).toString();

    return {
      snapshot,
      surface,
      models: models.map(toSidebarModel),
      preferredModelId: (models.find((model) => model.id === snapshot.selectedModelId) ?? models[0])?.id,
      profile: await this.profiles.view(snapshot.accountSummary?.profile),
      logoUri: resource('favicon.svg'),
      datalabLogoUri: resource('datalab-logo.svg'),
      syntaxColors: await loadSyntaxColors()
    };
  }

  /** Routes a message of the Customizations page to the controller of its section. */
  private async handleCustomize(message: SidebarMessage, page: NonNullable<ViewProvider['customize']>): Promise<void> {
    const [section] = message.command.split('/');
    try {
      switch (section) {
        case 'mcp':
          await page.mcp?.handle(message as unknown as McpCommand);
          break;
        case 'tools':
          await page.tools?.handle(message as unknown as ToolsCommand);
          break;
        case 'skills':
          await page.skills.handle(message as unknown as SkillsCommand);
          break;
        case 'agents':
          await page.agents.handle(message as unknown as AgentsCommand);
          break;
        case 'hooks':
          await page.hooks?.handle(message as unknown as HooksCommand);
          break;
        case 'settings':
          await page.settings.handle(message as unknown as SettingsCommand);
          break;
        case 'customize':
          if (message.command === 'customize/ready') {
            this.showSection();
          }
          break;
      }
    } catch (error) {
      this.diagnostics.error(`Nova ${section} action failed.`, error);
      void window.showErrorMessage(toUserMessage(error));
      page.skills.refresh();
      page.agents.refresh();
      void page.settings.refresh();
      void page.tools?.refresh();
      page.mcp?.refresh();
      void page.hooks?.refresh();
    }
  }

  private async renderDocument(webview: Webview, surface: Surface): Promise<string> {
    const entry = Manifest.entry(WEBVIEW_ENTRY);
    const file = entry.file;
    if (!file) {
      throw new Error('Nova webview bundle manifest is missing the index script. Run `npm run build:webview`.');
    }

    const webviewRoot = Uri.joinPath(this.extensionUri, 'out', 'webview');
    const generatedHtml = await readFile(Uri.joinPath(webviewRoot, 'webview', 'index.html').fsPath, 'utf8');

    return renderWebviewDocument({
      generatedHtml,
      state: await this.createState(webview, surface),
      nonce: randomUUID(),
      cspSource: webview.cspSource,
      resources: [file, ...entry.css],
      toWebviewUri: (resource) => webview.asWebviewUri(Uri.joinPath(webviewRoot, ...resource.split('/'))).toString()
    });
  }
}

/** Messages posted by the sidebar webview. */
interface SidebarMessage {
  command: string;
  sessionId?: string;
  apiKey?: string;
  query?: string;
  mode?: 'ask' | 'agent';
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export interface SidebarModel {
  id: string;
  name: string;
  detail?: string;
  contextWindow: number;
  toolCalling: boolean;
  imageInput: boolean;
  pricing?: string;
}

export interface SidebarRenderState {
  snapshot: SessionSnapshot;
  /** Token colors of the active editor theme for code in answers; absent when they cannot be read. */
  syntaxColors?: SyntaxColors;
  /** The signed-in user for the avatar; undefined until the Nova API reports a profile. */
  profile?: ProfileView;
  /** Where this webview runs: the sidebar view or an editor tab. */
  surface?: Surface;
  models?: SidebarModel[];
  preferredModelId?: string;
  logoUri?: string;
  datalabLogoUri?: string;
}

function toSidebarModel(model: LanguageModelInfo): SidebarModel {
  return {
    id: model.id,
    name: model.name,
    detail: model.detail,
    contextWindow: model.maxContextWindowTokens ?? model.maxInputTokens + model.maxOutputTokens,
    toolCalling: Boolean(model.capabilities.toolCalling),
    imageInput: Boolean(model.capabilities.imageInput),
    pricing: pricingLabel(model)
  };
}

export interface RenderWebviewDocumentInput {
  generatedHtml: string;
  state: SidebarRenderState;
  nonce: string;
  cspSource: string;
  resources: Resource[];
  toWebviewUri(resource: string): string;
}

export function renderWebviewDocument(input: RenderWebviewDocumentInput): string {
  const resourceMap = new Map(input.resources.map((resource) => [resource.toString(), input.toWebviewUri(resource.toString())]));
  let html = input.generatedHtml;

  html = rewriteAssetUris(html, resourceMap, input.toWebviewUri);
  html = html.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${escapeAttribute(input.nonce)}"`);
  html = injectHead(html, createCspMeta(input.cspSource, input.nonce));
  html = injectBody(html, createBootstrapScript(input.state, input.nonce));
  html = injectLoader(html);

  return html;
}

function rewriteAssetUris(
  html: string,
  resourceMap: ReadonlyMap<string, string>,
  toWebviewUri: (resource: string) => string
): string {
  return html.replace(/\b(src|href)=(["'])\/([^"']+)\2/g, (match, attribute: string, quote: string, resource: string) => {
    if (!resource.startsWith('assets/')) {
      return match;
    }

    return `${attribute}=${quote}${resourceMap.get(resource) ?? toWebviewUri(resource)}${quote}`;
  });
}

function injectHead(html: string, content: string): string {
  if (html.includes(HEAD_MARKER)) {
    return html.replace(HEAD_MARKER, content);
  }
  return html.replace('</head>', `${content}\n</head>`);
}

function injectBody(html: string, content: string): string {
  if (html.includes(BODY_MARKER)) {
    return html.replace(BODY_MARKER, content);
  }

  return html.replace('</body>', `${content}\n</body>`);
}

function injectLoader(html: string): string {
  const loader = '<div class="nova-loader" aria-label="Loading Nova AI"></div>';
  return html.replace('<div id="app"></div>', `<div id="app">${loader}</div>`);
}

function createCspMeta(cspSource: string, nonce: string): string {
  const escapedCspSource = escapeAttribute(cspSource);
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapedCspSource} data:; font-src ${escapedCspSource}; style-src ${escapedCspSource}; script-src 'nonce-${escapeAttribute(nonce)}';">`;
}

function createBootstrapScript(state: SidebarRenderState, nonce: string): string {
  return `<script nonce="${escapeAttribute(nonce)}">window.__NOVA_SIDEBAR_STATE__ = ${escapeScript(JSON.stringify(state))};</script>`;
}

/** A tab can be closed while its chat still reports (a stopped reply saving). */
function postSafely(webview: Webview, event: unknown): void {
  try {
    void Promise.resolve(webview.postMessage(event)).catch(() => undefined);
  } catch {
    // disposed webview
  }
}

function escapeScript(value: string): string {
  return value
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export { NOVA_SIDEBAR_VIEW_ID };
