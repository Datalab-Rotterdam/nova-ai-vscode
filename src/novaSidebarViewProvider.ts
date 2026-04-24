import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    COMMAND_OPEN_CHAT,
    COMMAND_OPEN_SETTINGS,
    COMMAND_REFRESH_MODELS,
    COMMAND_SIGN_IN,
    COMMAND_SIGN_OUT,
    NOVA_SIDEBAR_VIEW_ID
} from './constants';
import {NovaDiagnostics} from './novaDiagnostics';
import {NovaModelProvider} from './novaModelProvider';
import {NovaSessionService} from './novaSessionService';
import {toUserMessage} from './novaErrors';
import {renderSidebarDocument} from './views/sidebarHtml';
import type {SidebarRenderState} from './views/sidebarHtml';

export class NovaSidebarViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private assetManifest?: WebviewAssetManifest;

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sessionService: NovaSessionService,
        private readonly modelProvider: NovaModelProvider,
        private readonly diagnostics: NovaDiagnostics
    ) {
        this.sessionService.onDidChangeSession(() => void this.refresh());
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
                vscode.Uri.joinPath(this.extensionUri, 'resources')
            ]
        };

        view.webview.onDidReceiveMessage(async (message: { command?: string; apiKey?: string }) => {
            try {
                switch (message.command) {
                    case COMMAND_SIGN_IN:
                        await vscode.commands.executeCommand(COMMAND_SIGN_IN, message.apiKey);
                        break;
                    case COMMAND_REFRESH_MODELS:
                        await vscode.commands.executeCommand(COMMAND_REFRESH_MODELS);
                        break;
                    case COMMAND_SIGN_OUT:
                        await vscode.commands.executeCommand(COMMAND_SIGN_OUT);
                        break;
                    case COMMAND_OPEN_CHAT:
                        await vscode.commands.executeCommand(COMMAND_OPEN_CHAT);
                        break;
                    case COMMAND_OPEN_SETTINGS:
                        await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
                        break;
                    default:
                        break;
                }
            } catch (error) {
                this.diagnostics.error('Nova sidebar action failed.', error);
                void vscode.window.showErrorMessage(toUserMessage(error));
            }
        });

        void this.refresh();
    }

    public async refresh(): Promise<void> {
        if (!this.view) {
            return;
        }

        const assets = await this.getAssetManifest();
        const snapshot = await this.sessionService.getSnapshot();
        const models = await this.modelProvider.getCachedModels();
        const preferredModel = models.find((model) => model.id === snapshot.selectedModelId) ?? models[0];
        const nonce = crypto.randomUUID();
        const logoUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'resources', 'favicon.svg')
        ).toString();
        const state: SidebarRenderState = {snapshot, preferredModel, logoUri};
        const scriptUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', assets.jsFile)
        ).toString();
        const styleUri = assets.cssFile
            ? this.view.webview.asWebviewUri(
                vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', assets.cssFile)
            ).toString()
            : undefined;

        this.view.webview.html = renderSidebarDocument(
            state,
            nonce,
            this.view.webview.cspSource,
            scriptUri,
            styleUri
        );
    }

    private async getAssetManifest(): Promise<WebviewAssetManifest> {
        if (this.assetManifest) {
            return this.assetManifest;
        }

        const manifestPath = path.join(this.extensionUri.fsPath, 'out', 'webview', '.vite', 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent) as Record<string, { file: string; css?: string[] }>;
        const entry = manifest['webview/index.html'];
        if (!entry) {
            throw new Error('Nova webview bundle manifest is missing the index entry. Run `npm run build:webview`.');
        }

        this.assetManifest = {
            jsFile: entry.file,
            cssFile: entry.css?.[0]
        };

        return this.assetManifest;
    }
}

export {NOVA_SIDEBAR_VIEW_ID};

interface WebviewAssetManifest {
    jsFile: string;
    cssFile?: string;
}
