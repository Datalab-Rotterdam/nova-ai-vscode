import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commands, type QuickPickItem, Uri, WebviewView, WebviewViewProvider, window } from 'vscode';
import { ChatService, type ChatRenderState } from '../chat/ChatService';
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
import type { ChatApprovalPolicy, ChatEnvironmentScope, LanguageModelInfo, SessionSnapshot } from '../core/types';
import { ModelProvider } from '../model/modelProvider';
import { SessionService } from '../services/SessionService';
import { Manifest, Resource } from './svelte';

const WEBVIEW_ENTRY = 'webview/index.html' as const;
const HEAD_MARKER = '<!--nova:svelte-head-->';
const BODY_MARKER = '<!--nova:svelte-body-->';

export class ViewProvider implements WebviewViewProvider {
  private view?: WebviewView;
  private initialized = false;

  public constructor(
    private readonly extensionUri: Uri,
    private readonly sessionService: SessionService,
    private readonly modelProvider: ModelProvider,
    private readonly chatService: ChatService,
    private readonly diagnostics: Diagnostics
  ) {
    this.sessionService.onDidChangeSession(() => void this.refresh());
    this.chatService.onDidChangeState(() => void this.refresh());
  }

  public resolveWebviewView(view: WebviewView): void {
    this.view = view;
    this.initialized = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(this.extensionUri, 'out', 'webview'),
        Uri.joinPath(this.extensionUri, 'resources')
      ]
    };

    view.webview.onDidReceiveMessage(async (message: {
      command?: string;
      apiKey?: string;
      prompt?: string;
      messageId?: string;
      modelId?: string;
      settingsQuery?: string;
      chatId?: string;
      mode?: 'agent' | 'ask' | 'plan';
      customAgentId?: string;
      approvalPolicy?: 'always' | 'safeOnly' | 'neverForSafe';
      environmentScope?: 'local' | 'chatOnly';
    }) => {
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
            await commands.executeCommand(COMMAND_OPEN_SETTINGS, message.settingsQuery);
            break;
          case 'nova.chat.submit':
            if (typeof message.prompt === 'string') {
              const state = await this.buildRenderState();
              const model = state.availableModels.find((item) => item.id === state.snapshot.selectedModelId) ?? state.availableModels[0];
              if (!model) {
                throw new Error('Nova AI did not return any available models for chat.');
              }

              await this.sessionService.setSelectedModel(model.id);
              await this.chatService.submit(message.prompt, model);
            }
            break;
          case 'nova.chat.editAndResubmit':
            if (typeof message.prompt === 'string' && typeof message.messageId === 'string') {
              const state = await this.buildRenderState();
              const model = state.availableModels.find((item) => item.id === state.snapshot.selectedModelId) ?? state.availableModels[0];
              if (!model) {
                throw new Error('Nova AI did not return any available models for chat.');
              }

              await this.sessionService.setSelectedModel(model.id);
              await this.chatService.editAndResubmit(message.messageId, message.prompt, model);
            }
            break;
          case 'nova.chat.clear':
            await this.chatService.clear();
            break;
          case 'nova.chat.create':
            await this.chatService.createSession();
            break;
          case 'nova.chat.switch':
            if (typeof message.chatId === 'string') {
              await this.chatService.switchChat(message.chatId);
            }
            break;
          case 'nova.chat.rename':
            if (typeof message.chatId === 'string') {
              await this.chatService.renameSession(message.chatId);
            }
            break;
          case 'nova.chat.delete':
            if (typeof message.chatId === 'string') {
              await this.chatService.deleteSession(message.chatId);
            }
            break;
          case 'nova.chat.archive':
            if (typeof message.chatId === 'string') {
              await this.chatService.archiveSession(message.chatId);
            }
            break;
          case 'nova.chat.selectModel':
            if (typeof message.modelId === 'string') {
              await this.sessionService.setSelectedModel(message.modelId);
              await this.chatService.selectModel(message.modelId);
            }
            break;
          case 'nova.chat.pickModel':
            await this.pickModel();
            break;
          case 'nova.chat.selectMode':
            if (message.mode) {
              await this.chatService.selectMode(message.mode);
            }
            break;
          case 'nova.chat.selectCustomAgent':
            await this.chatService.selectCustomAgent(message.customAgentId);
            break;
          case 'nova.chat.selectApprovalPolicy':
            if (message.approvalPolicy) {
              await this.chatService.selectApprovalPolicy(message.approvalPolicy);
            }
            break;
          case 'nova.chat.pickApprovalPolicy':
            await this.pickApprovalPolicy();
            break;
          case 'nova.chat.selectEnvironment':
            if (message.environmentScope) {
              await this.chatService.selectEnvironmentScope(message.environmentScope);
            }
            break;
          case 'nova.chat.pickEnvironment':
            await this.pickEnvironment();
            break;
          case 'nova.chat.configureAgents':
            await commands.executeCommand(COMMAND_OPEN_SETTINGS, 'nova.chat.customAgents');
            break;
          default:
            break;
        }
      } catch (error) {
        this.diagnostics.error('Nova sidebar action failed.', error);
        void window.showErrorMessage(toUserMessage(error));
      }
    });

    view.onDidDispose(() => {
      this.initialized = false;
      this.view = undefined;
    });

    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const state = await this.buildRenderState();
    if (!this.initialized) {
      await this.renderHtml(state);
      this.initialized = true;
    } else {
      await this.view.webview.postMessage({
        type: 'state',
        state
      });
    }
  }

  private async buildRenderState(): Promise<SidebarRenderState> {
    const snapshot = await this.sessionService.getSnapshot();
    const models = await this.modelProvider.getCachedModels();
    const preferredModel = models.find((model) => model.id === snapshot.selectedModelId) ?? models[0];
    const logoUri = this.view?.webview.asWebviewUri(
      Uri.joinPath(this.extensionUri, 'resources', 'favicon.svg')
    ).toString();

    return {
      snapshot,
      preferredModel,
      availableModels: models,
      logoUri,
      chat: this.chatService.getRenderState()
    };
  }

  private async pickModel(): Promise<void> {
    const state = await this.buildRenderState();
    const items = state.availableModels.map((model) => ({
      label: model.name,
      description: model.id === state.snapshot.selectedModelId ? 'Current model' : model.detail,
      detail: model.capabilities.toolCalling ? 'Tool calling available' : 'Chat only',
      modelId: model.id
    }));
    const selection = await window.showQuickPick(items, {
      title: 'Select Nova chat model',
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: 'Choose the model to use for this chat'
    });
    if (!selection) {
      return;
    }

    await this.sessionService.setSelectedModel(selection.modelId);
    await this.chatService.selectModel(selection.modelId);
  }

  private async pickApprovalPolicy(): Promise<void> {
    const current = this.chatService.getRenderState().activeApprovalPolicy;
    const selection = await window.showQuickPick<ApprovalPolicyPick>(approvalPolicyItems(current), {
      title: 'Tool approvals',
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: 'Choose how Nova should request permission before running tools'
    });
    if (!selection) {
      return;
    }

    await this.chatService.selectApprovalPolicy(selection.value);
  }

  private async pickEnvironment(): Promise<void> {
    const current = this.chatService.getRenderState().activeEnvironmentScope;
    const selection = await window.showQuickPick<EnvironmentPick>(environmentItems(current), {
      title: 'Tool scope',
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: 'Choose whether this chat can use workspace and MCP tools'
    });
    if (!selection) {
      return;
    }

    await this.chatService.selectEnvironmentScope(selection.value);
  }

  private async renderHtml(state: SidebarRenderState): Promise<void> {
    const entry = Manifest.entry(WEBVIEW_ENTRY);
    const cssFiles = entry.css;
    const file = entry.file;
    if (!file) {
      throw new Error('Nova webview bundle manifest is missing the index script. Run `npm run build:webview`.');
    }

    const nonce = randomUUID();
    const webviewRoot = Uri.joinPath(this.extensionUri, 'out', 'webview');
    const generatedHtml = await readFile(
      Uri.joinPath(webviewRoot, 'webview', 'index.html').fsPath,
      'utf8'
    );
    const resources = [file, ...cssFiles];
    const toWebviewUri = (resource: string) =>
      this.view!.webview.asWebviewUri(Uri.joinPath(webviewRoot, ...resource.split('/'))).toString();

    this.view!.webview.html = renderWebviewDocument({
      generatedHtml,
      state,
      nonce,
      cspSource: this.view!.webview.cspSource,
      resources,
      toWebviewUri
    });
  }
}

export interface SidebarRenderState {
  snapshot: SessionSnapshot;
  preferredModel?: LanguageModelInfo;
  availableModels: readonly LanguageModelInfo[];
  logoUri?: string;
  chat: ChatRenderState;
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

interface ApprovalPolicyPick extends QuickPickItem {
  value: ChatApprovalPolicy;
}

interface EnvironmentPick extends QuickPickItem {
  value: ChatEnvironmentScope;
}

function approvalPolicyItems(current: ChatApprovalPolicy): ApprovalPolicyPick[] {
  return [
    {
      label: 'Default Approvals',
      description: current === 'safeOnly' ? 'Current' : undefined,
      detail: 'Allow built-in safe tools automatically and ask before other tools.',
      value: 'safeOnly'
    },
    {
      label: 'Always Confirm',
      description: current === 'always' ? 'Current' : undefined,
      detail: 'Ask before every tool call, including safe built-in tools.',
      value: 'always'
    },
    {
      label: 'Allow All Tools',
      description: current === 'neverForSafe' ? 'Current' : undefined,
      detail: 'Run tools without prompting in this chat.',
      value: 'neverForSafe'
    }
  ];
}

function environmentItems(current: ChatEnvironmentScope): EnvironmentPick[] {
  return [
    {
      label: 'Local',
      description: current === 'local' ? 'Current' : undefined,
      detail: 'Allow workspace and MCP tools when the current mode supports them.',
      value: 'local'
    },
    {
      label: 'Chat Only',
      description: current === 'chatOnly' ? 'Current' : undefined,
      detail: 'Disable tool calls and keep the chat text-only.',
      value: 'chatOnly'
    }
  ];
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
