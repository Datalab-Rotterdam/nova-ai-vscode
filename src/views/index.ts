import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commands, Uri, ViewColumn, Webview, WebviewPanel, WebviewPanelSerializer, WebviewView, WebviewViewProvider, window } from 'vscode';
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
  NOVA_SIDEBAR_VIEW_ID
} from '../core/constants';
import { toUserMessage } from '../core/errors';
import type { LanguageModelInfo, ProfileView, SessionSnapshot } from '../core/types';
import { ProfileService } from '../services/ProfileService';
import { ModelProvider, pricingLabel } from '../model/modelProvider';
import type { ChatController } from '../panel/ChatController';
import type { ChatCommand, ChatEvent } from '../panel/protocol';
import { SessionService } from '../services/SessionService';
import { Manifest, Resource } from './svelte';

const WEBVIEW_ENTRY = 'webview/index.html' as const;
const HEAD_MARKER = '<!--nova:svelte-head-->';
const BODY_MARKER = '<!--nova:svelte-body-->';

export type Surface = 'sidebar' | 'editor';

export const CHAT_PANEL_VIEW_TYPE = 'nova.chatPanel';

/**
 * Hosts the Nova UI in the sidebar view and, optionally, in an editor tab. Both run the
 * same webview bundle; chat events are broadcast to every open surface so streaming,
 * approvals and the message queue stay in sync.
 */
export class ViewProvider implements WebviewViewProvider, WebviewPanelSerializer {
  private view?: WebviewView;
  private panel?: WebviewPanel;
  /** Runs the Nova chat shown in these views; set after construction. */
  public chat?: ChatController;
  private readonly profiles = new ProfileService();

  public constructor(
    private readonly extensionUri: Uri,
    private readonly sessionService: SessionService,
    private readonly modelProvider: ModelProvider,
    private readonly diagnostics: Diagnostics
  ) {
    this.sessionService.onDidChangeSession(() => void this.refresh());
    this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refresh());
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

  /** Restores the editor tab after a window reload. */
  public async deserializeWebviewPanel(panel: WebviewPanel): Promise<void> {
    await this.adoptPanel(panel);
  }

  /** Opens (or reveals) the Nova chat as an editor tab. */
  public async openInEditor(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, 'Nova Chat', ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: this.resourceRoots()
    });
    await this.adoptPanel(panel);
  }

  private async adoptPanel(panel: WebviewPanel): Promise<void> {
    this.panel = panel;
    panel.iconPath = {
      light: Uri.joinPath(this.extensionUri, 'resources', 'nova-dark.svg'),
      dark: Uri.joinPath(this.extensionUri, 'resources', 'favicon.svg')
    };
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    await this.attach(panel.webview, 'editor');
  }

  /** Asks the sidebar webview to show a view (from the VS Code title bar buttons). */
  public async showInSidebar(view: 'history' | 'account'): Promise<void> {
    await this.view?.webview.postMessage({ type: 'ui', action: view });
  }

  /** Pushes the current session and model state to every surface. */
  public async refresh(): Promise<void> {
    await Promise.all(this.surfaces().map(async ({ webview, surface }) =>
      webview.postMessage({ type: 'state', state: await this.createState(webview, surface) })));
  }

  /** Sends a chat event to every surface; a surface that is not loaded resyncs on `chat/ready`. */
  public postChat(event: ChatEvent): void {
    for (const { webview } of this.surfaces()) {
      void webview.postMessage(event);
    }
  }

  private surfaces(): Array<{ webview: Webview; surface: Surface }> {
    return [
      ...(this.view ? [{ webview: this.view.webview, surface: 'sidebar' as const }] : []),
      ...(this.panel ? [{ webview: this.panel.webview, surface: 'editor' as const }] : [])
    ];
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
    if (message.command.startsWith('chat/')) {
      try {
        await this.chat?.handle(message as unknown as ChatCommand);
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
