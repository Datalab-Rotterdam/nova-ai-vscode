import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commands, Uri, Webview, WebviewView, WebviewViewProvider, window } from 'vscode';
import { Diagnostics } from '../core/diagnostics';
import {
  COMMAND_OPEN_CHAT,
  COMMAND_OPEN_SETTINGS,
  COMMAND_REFRESH_MODELS,
  COMMAND_SIGN_IN,
  COMMAND_SIGN_OUT,
  NOVA_SIDEBAR_VIEW_ID
} from '../core/constants';
import { toUserMessage } from '../core/errors';
import type { LanguageModelInfo, SessionSnapshot } from '../core/types';
import { ModelProvider } from '../model/modelProvider';
import { SessionService } from '../services/SessionService';
import { Manifest, Resource } from './svelte';

const WEBVIEW_ENTRY = 'webview/index.html' as const;
const HEAD_MARKER = '<!--nova:svelte-head-->';
const BODY_MARKER = '<!--nova:svelte-body-->';

export class ViewProvider implements WebviewViewProvider {
  private view?: WebviewView;

  public constructor(
    private readonly extensionUri: Uri,
    private readonly sessionService: SessionService,
    private readonly modelProvider: ModelProvider,
    private readonly diagnostics: Diagnostics
  ) {
    this.sessionService.onDidChangeSession(() => void this.refresh());
  }

  public resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(this.extensionUri, 'out', 'webview'),
        Uri.joinPath(this.extensionUri, 'resources')
      ]
    };

    view.webview.onDidReceiveMessage(async (message: { command?: string; apiKey?: string }) => {
      try {
        switch (message.command) {
          case COMMAND_SIGN_IN:
            await commands.executeCommand(COMMAND_SIGN_IN, message.apiKey);
            break;
          case COMMAND_REFRESH_MODELS:
            await commands.executeCommand(COMMAND_REFRESH_MODELS);
            break;
          case COMMAND_SIGN_OUT:
            await commands.executeCommand(COMMAND_SIGN_OUT);
            break;
          case COMMAND_OPEN_CHAT:
            await commands.executeCommand(COMMAND_OPEN_CHAT);
            break;
          case COMMAND_OPEN_SETTINGS:
            await commands.executeCommand(COMMAND_OPEN_SETTINGS);
            break;
          default:
            break;
        }
      } catch (error) {
        this.diagnostics.error('Nova sidebar action failed.', error);
        void window.showErrorMessage(toUserMessage(error));
      }
    });

    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const entry = Manifest.entry(WEBVIEW_ENTRY);
    const cssFiles = entry.css;
    const file = entry.file;
    if (!file) {
      throw new Error('Nova webview bundle manifest is missing the index script. Run `npm run build:webview`.');
    }

    const snapshot = await this.sessionService.getSnapshot();
    const models = await this.modelProvider.getCachedModels();
    const preferredModel = models.find((model) => model.id === snapshot.selectedModelId) ?? models[0];
    const nonce = randomUUID();
    const webviewRoot = Uri.joinPath(this.extensionUri, 'out', 'webview');
    const generatedHtml = await readFile(
      Uri.joinPath(webviewRoot, 'webview', 'index.html').fsPath,
      'utf8'
    );
    const logoUri = this.view.webview.asWebviewUri(
      Uri.joinPath(this.extensionUri, 'resources', 'favicon.svg')
    ).toString();
    const state: SidebarRenderState = { snapshot, preferredModel, logoUri };
    const resources = [file, ...cssFiles];
    const toWebviewUri = (resource: string) =>
      this.view!.webview.asWebviewUri(Uri.joinPath(webviewRoot, ...resource.split('/'))).toString();

    this.view.webview.html = renderWebviewDocument({
      generatedHtml,
      state,
      nonce,
      cspSource: this.view.webview.cspSource,
      resources,
      toWebviewUri
    });
  }
}

export interface SidebarRenderState {
  snapshot: SessionSnapshot;
  preferredModel?: LanguageModelInfo;
  logoUri?: string;
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
  html = injectLoader(html, input.state.logoUri);

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

function injectLoader(html: string, logoUri?: string): string {
  const loaderLogo = logoUri
    ? `<img class="nova-loader__logo" src="${escapeAttribute(logoUri)}" alt="Nova AI" />`
    : '<div class="nova-loader__mark" aria-hidden="true"></div>';
  const loader = `<div class="nova-loader" aria-label="Loading Nova AI">${loaderLogo}</div>`;
  return html.replace('<div id="app"></div>', `<div id="app">${loader}</div>`);
}

function createCspMeta(cspSource: string, nonce: string): string {
  const escapedCspSource = escapeAttribute(cspSource);
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapedCspSource} https: data:; media-src ${escapedCspSource}; style-src ${escapedCspSource}; script-src 'nonce-${escapeAttribute(nonce)}';">`;
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
