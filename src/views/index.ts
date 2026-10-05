import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commands, Disposable, ThemeIcon, Uri, ViewColumn, Webview, WebviewPanel, WebviewPanelSerializer, WebviewView, WebviewViewProvider, window } from 'vscode';
import type { SkillsCommand } from '../skills/protocol';
import type { SkillPaths } from '../skills/SkillService';
import { SkillsController } from '../skills/SkillsController';
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

const WEBVIEW_ENTRY = 'webview/index.html' as const;
const HEAD_MARKER = '<!--nova:svelte-head-->';
const BODY_MARKER = '<!--nova:svelte-body-->';

export type Surface = 'sidebar' | 'editor' | 'skills';

export const CHAT_PANEL_VIEW_TYPE = 'nova.chatPanel';
export const SKILLS_VIEW_TYPE = 'nova.skills';

export type ChatFactory = (post: (event: ChatEvent) => void, options: ChatControllerOptions) => ChatController;

/**
 * Hosts the Nova UI in the sidebar view and in editor tabs. The sidebar shows one chat at
 * a time; every editor tab has a chat of its own (its own controller), so several chats
 * can be open, and running, side by side. A chat is open in one place only (see ChatHub).
 */
export class ViewProvider implements WebviewViewProvider, WebviewPanelSerializer, Disposable {
  private view?: WebviewView;
  private sidebarChat?: ChatController;
  private readonly panels = new Map<WebviewPanel, ChatController>();
  /** The editor tab the user used last; undefined: the sidebar. Commands go there. */
  private lastActivePanel?: WebviewPanel;
  private createChat?: ChatFactory;
  private readonly profiles = new ProfileService();
  private skillPaths?: () => SkillPaths;
  private skills?: { panel: WebviewPanel; controller: SkillsController };

  public constructor(
    private readonly extensionUri: Uri,
    private readonly sessionService: SessionService,
    private readonly modelProvider: ModelProvider,
    private readonly diagnostics: Diagnostics
  ) {
    this.sessionService.onDidChangeSession(() => void this.refresh());
    this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refresh());
  }

  /** Sets how chats are created and creates the sidebar's. */
  public useChats(createChat: ChatFactory): void {
    this.createChat = createChat;
    this.sidebarChat = this.newSidebarChat(undefined);
  }

  /** Where skills live, for the Skills page. */
  public useSkills(paths: () => SkillPaths): void {
    this.skillPaths = paths;
  }

  /** The Skills page (one editor tab): skills of every project, or of this one. */
  public async openSkills(): Promise<void> {
    if (this.skills) {
      this.skills.panel.reveal();
      return;
    }
    await this.adoptSkillsPanel(window.createWebviewPanel(SKILLS_VIEW_TYPE, 'Nova Skills', ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: this.resourceRoots()
    }));
  }

  /** Restores the Skills tab after a window reload. */
  public readonly skillsSerializer: WebviewPanelSerializer = {
    deserializeWebviewPanel: (panel) => this.adoptSkillsPanel(panel)
  };

  private async adoptSkillsPanel(panel: WebviewPanel): Promise<void> {
    if (!this.skillPaths) {
      panel.dispose();
      return;
    }
    panel.iconPath = new ThemeIcon('book');
    const controller = new SkillsController(this.skillPaths, (message) => postSafely(panel.webview, message));
    this.skills = { panel, controller };
    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        controller.refresh();
      }
    });
    panel.onDidDispose(() => {
      controller.dispose();
      if (this.skills?.panel === panel) {
        this.skills = undefined;
      }
    });
    await this.attach(panel.webview, 'skills');
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
    this.sidebarChat?.dispose();
    this.skills?.controller.dispose();
  }

  public async resolveWebviewView(view: WebviewView): Promise<void> {
    this.view = view;
    view.onDidDispose(() => (this.view = undefined));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.refresh();
      }
    });
    await this.attach(view.webview, 'sidebar');
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
  public async openInEditor(): Promise<void> {
    const moving = this.sidebar;
    if (moving.isEmpty) {
      await this.openNewTab(null);
      return;
    }
    this.sidebarChat = this.newSidebarChat(null);
    await moving.forgetLast();
    await this.adoptPanel(this.createPanel(moving.title), () => moving);
    await this.sidebarChat.handle({ command: 'chat/ready' });
  }

  /** Opens a chat (or a new one) in an editor tab; a chat open elsewhere is shown there. */
  public async openChatInEditor(sessionId: string): Promise<void> {
    const owner = this.ownerOf(sessionId);
    if (owner === this.sidebarChat) {
      await this.openInEditor();
    } else if (owner) {
      await owner.reveal();
    } else {
      await this.openNewTab(sessionId);
    }
  }

  public async openNewTab(sessionId: string | null): Promise<void> {
    await this.adoptPanel(this.createPanel('New chat'), (post, options) => this.chatFactory()(post, { ...options, initialSessionId: sessionId }));
  }

  /** Asks the sidebar webview to show a view (from the VS Code title bar buttons). */
  public async showInSidebar(view: 'history' | 'account' | 'chat'): Promise<void> {
    await this.view?.webview.postMessage({ type: 'ui', action: view });
  }

  public async revealSidebar(): Promise<void> {
    for (const command of [`workbench.view.extension.${NOVA_VIEW_CONTAINER_ID}`, `${NOVA_SIDEBAR_VIEW_ID}.focus`]) {
      try {
        await commands.executeCommand(command);
      } catch {
        // older hosts without one of the commands
      }
    }
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

  private newSidebarChat(initialSessionId: string | null | undefined): ChatController {
    return this.chatFactory()((event) => this.view && postSafely(this.view.webview, event), {
      rememberLast: true,
      initialSessionId,
      reveal: () => this.revealSidebar()
    });
  }

  private ownerOf(sessionId: string): ChatController | undefined {
    return [this.sidebarChat, ...this.panels.values()].find((controller) => controller?.currentSessionId === sessionId);
  }

  private createPanel(title: string): WebviewPanel {
    return window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, title || 'New chat', ViewColumn.Active, {
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
    const post = (event: ChatEvent) => postSafely(panel.webview, event);
    const reveal = () => panel.reveal();
    const onTitle = (title: string) => {
      const next = title || 'New chat';
      if (panel.title !== next) {
        panel.title = next;
      }
    };
    const controller = chatFor(post, { rememberLast: false, reveal, onTitle });
    if (controller === this.sidebarChat || [...this.panels.values()].includes(controller)) {
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
      this.panels.delete(panel);
      if (this.lastActivePanel === panel) {
        this.lastActivePanel = undefined;
      }
      // A running reply is stopped; what it produced so far is saved.
      controller.dispose();
    });
    onTitle(controller.title);
    await this.attach(panel.webview, 'editor');
  }

  private surfaces(): Array<{ webview: Webview; surface: Surface }> {
    return [
      ...(this.view ? [{ webview: this.view.webview, surface: 'sidebar' as const }] : []),
      ...[...this.panels.keys()].map((panel) => ({ webview: panel.webview, surface: 'editor' as const })),
      ...(this.skills ? [{ webview: this.skills.panel.webview, surface: 'skills' as const }] : [])
    ];
  }

  private chatOf(webview: Webview): ChatController | undefined {
    if (this.view?.webview === webview) {
      return this.sidebarChat;
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
    if (message.command.startsWith('skills/')) {
      if (this.skills?.panel.webview === source) {
        try {
          await this.skills.controller.handle(message as unknown as SkillsCommand);
        } catch (error) {
          this.diagnostics.error('Nova skills action failed.', error);
          void window.showErrorMessage(toUserMessage(error));
          this.skills?.controller.refresh();
        }
      }
      return;
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
      datalabLogoUri: resource('datalab-logo.svg')
    };
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
