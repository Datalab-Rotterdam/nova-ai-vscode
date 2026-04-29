import * as vscode from 'vscode';
import { COMMAND_MANAGE } from '../core/constants';
import type { LanguageModelInfo, SessionSnapshot } from '../core/types';
import { estimateTokenCount } from '../model/tokenEstimator';

const NOVA_STATUS_ICON = '$(nova-logo)';
const STATUS_TOOLTIP = 'Click to manage Nova AI';

export class StatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;

    public constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.name = 'Nova AI';
        this.item.command = COMMAND_MANAGE;
        this.setDisconnected();
        this.item.show();
    }

    public updateSession(snapshot: SessionSnapshot, models: readonly LanguageModelInfo[]): void {
        if (!snapshot.hasApiKey || snapshot.connectionHealth === 'signedOut') {
            this.setDisconnected();
            return;
        }

        this.item.text = `${NOVA_STATUS_ICON}`;
        this.item.tooltip = STATUS_TOOLTIP;
        this.item.backgroundColor = undefined;
        this.item.show();
    }

    public updateRequest(
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        tools: readonly vscode.LanguageModelChatTool[] | undefined,
        model: LanguageModelInfo
    ): void {
        const messageTokens = messages.reduce((total, message) => total + estimateTokenCount(message), 0);
        const toolTokens = tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0;
        const usedTokens = messageTokens + toolTokens;
        const contextWindow = getContextWindow(model);
        const percentage = Math.min((usedTokens / contextWindow) * 100, 100);

        this.item.text = `${NOVA_STATUS_ICON}`;
        this.item.tooltip = STATUS_TOOLTIP;
        this.item.backgroundColor = getUsageBackground(percentage);
        this.item.show();
    }

    public dispose(): void {
        this.item.dispose();
    }

    private setDisconnected(): void {
        this.item.text = `${NOVA_STATUS_ICON}`;
        this.item.tooltip = STATUS_TOOLTIP;
        this.item.backgroundColor = undefined;
    }
}

function getContextWindow(model: LanguageModelInfo): number {
    return Math.max(1, model.maxInputTokens + model.maxOutputTokens);
}

function getUsageBackground(percentage: number): vscode.ThemeColor | undefined {
    if (percentage >= 90) {
        return new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    if (percentage >= 70) {
        return new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    return undefined;
}
