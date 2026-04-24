import * as vscode from 'vscode';
import { COMMAND_MANAGE, COMMAND_OPEN_CHAT, COMMAND_REFRESH_MODELS, COMMAND_SIGN_IN, COMMAND_SIGN_OUT, NOVA_SIDEBAR_VIEW_ID, NOVA_VENDOR, NOVA_VIEW_CONTAINER_ID } from './constants';
import { NovaDiagnostics } from './novaDiagnostics';
import { NovaModelProvider } from './novaModelProvider';
import { NovaSessionService } from './novaSessionService';
import { NovaSidebarViewProvider } from './novaSidebarViewProvider';
import { NovaSdkClientFactory } from './novaSdkClientFactory';
import { toUserMessage } from './novaErrors';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const diagnostics = new NovaDiagnostics();
  const clientFactory = new NovaSdkClientFactory();
  const sessionService = new NovaSessionService(context, clientFactory, diagnostics);
  const modelProvider = new NovaModelProvider(sessionService, diagnostics);
  const sidebarProvider = new NovaSidebarViewProvider(context.extensionUri, sessionService, modelProvider, diagnostics);

  context.subscriptions.push(
    diagnostics,
    vscode.lm.registerLanguageModelChatProvider(NOVA_VENDOR, modelProvider),
    vscode.window.registerWebviewViewProvider(NOVA_SIDEBAR_VIEW_ID, sidebarProvider),
    vscode.commands.registerCommand(COMMAND_MANAGE, async () => {
      await focusNovaSidebar(sidebarProvider);
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
        void vscode.window.showInformationMessage('Nova AI connected.');
      } catch (error) {
        diagnostics.error('Nova sign-in failed.', error);
        void vscode.window.showErrorMessage(toUserMessage(error));
      }
    }),
    vscode.commands.registerCommand(COMMAND_SIGN_OUT, async () => {
      await sessionService.signOut();
      await sidebarProvider.refresh();
      void vscode.window.showInformationMessage('Nova AI signed out.');
    }),
    vscode.commands.registerCommand(COMMAND_REFRESH_MODELS, async () => {
      try {
        const models = await modelProvider.refreshModels();
        await sidebarProvider.refresh();
        void vscode.window.showInformationMessage(`Nova AI refreshed ${models.length} models.`);
      } catch (error) {
        diagnostics.error('Nova model refresh failed.', error);
        void vscode.window.showErrorMessage(toUserMessage(error));
      }
    }),
    vscode.commands.registerCommand(COMMAND_OPEN_CHAT, async () => {
      for (const command of ['workbench.action.chat.open', 'workbench.action.chat.newChat', 'workbench.panel.chat.view.copilot.focus']) {
        try {
          await vscode.commands.executeCommand(command);
          return;
        } catch {
          continue;
        }
      }

      void vscode.window.showWarningMessage('Unable to open the VS Code chat view from this version of VS Code.');
    })
  );

  await sessionService.validateExistingSession();
  await modelProvider.warmup();
}

export function deactivate(): void {}

async function focusNovaSidebar(sidebarProvider: NovaSidebarViewProvider): Promise<void> {
  for (const command of [`workbench.view.extension.${NOVA_VIEW_CONTAINER_ID}`, `${NOVA_SIDEBAR_VIEW_ID}.focus`]) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      continue;
    }
  }

  await sidebarProvider.refresh();
}
