import * as vscode from 'vscode';
import { COMMAND_MANAGE } from '../core/constants';
import type { LanguageModelInfo, SessionSnapshot } from '../core/types';
import { estimateTokenCount } from '../model/tokenEstimator';

const NOVA_STATUS_ICON = '$(nova-logo)';

export interface UsageLimit {
    label: string;
    used: number;
    total: number;
    resetAt?: Date;
}

export class StatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private modelName: string = '';
    private contextUsage: { used: number; total: number } | undefined;
    private limits: UsageLimit[] = [];

    public constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.name = 'Nova AI';
        this.item.command = COMMAND_MANAGE;
        this.setDisconnected();
        this.item.show();
    }

    public updateSession(snapshot: SessionSnapshot, _models: readonly LanguageModelInfo[]): void {
        if (!snapshot.hasApiKey || snapshot.connectionHealth === 'signedOut') {
            this.setDisconnected();
            return;
        }
        this.refresh();
    }

    public updateRequest(
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        tools: readonly vscode.LanguageModelChatTool[] | undefined,
        model: LanguageModelInfo
    ): void {
        const messageTokens = messages.reduce((total, message) => total + estimateTokenCount(message), 0);
        const toolTokens = tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0;
        this.setContextUsage(messageTokens + toolTokens, getContextWindow(model), model.name);
    }

    public updateActualUsage(promptTokens: number, contextWindow: number, modelName: string): void {
        this.setContextUsage(promptTokens, contextWindow, modelName);
    }

    public updateLimits(limits: UsageLimit[]): void {
        this.limits = limits;
        this.refresh();
    }

    public dispose(): void {
        this.item.dispose();
    }

    private setContextUsage(used: number, total: number, modelName: string): void {
        this.modelName = modelName;
        this.contextUsage = { used, total };
        this.refresh();
    }

    private refresh(): void {
        if (!this.contextUsage) {
            this.item.text = NOVA_STATUS_ICON;
            this.item.tooltip = buildIdleTooltip(this.limits);
            this.item.backgroundColor = undefined;
            this.item.show();
            return;
        }

        const { used, total } = this.contextUsage;
        const pct = Math.min(Math.round((used / Math.max(total, 1)) * 100), 100);

        this.item.text = NOVA_STATUS_ICON;
        this.item.tooltip = buildContextTooltip(this.modelName, used, total, pct, this.limits);
        this.item.backgroundColor = getUsageBackground(pct);
        this.item.show();
    }

    private setDisconnected(): void {
        this.contextUsage = undefined;
        this.modelName = '';
        this.item.text = NOVA_STATUS_ICON;
        const md = newMd();
        md.appendMarkdown('**Nova AI** — Click to manage');
        this.item.tooltip = md;
        this.item.backgroundColor = undefined;
    }
}

function buildIdleTooltip(limits: UsageLimit[]): vscode.MarkdownString {
    const md = newMd();
    md.appendMarkdown('**Nova AI**\n\n');
    md.appendMarkdown('---\n\n');
    md.appendMarkdown('*No context selected*\n\n');
    md.appendMarkdown('<span style="color:#888;font-size:0.9em">Start a chat to see context usage.</span>\n\n');
    appendLimits(md, limits);
    md.appendMarkdown(`[Manage Nova AI](command:${COMMAND_MANAGE})`);
    return md;
}

function buildContextTooltip(
    modelName: string,
    used: number,
    total: number,
    pct: number,
    limits: UsageLimit[]
): vscode.MarkdownString {
    const md = newMd();
    md.appendMarkdown('**Nova AI**\n\n');
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(`**Context Window** — *${modelName}*\n\n`);
    md.appendMarkdown(htmlProgressBar(pct));
    md.appendMarkdown(`\n\n${formatTokens(used)} / ${formatTokens(total)} tokens &nbsp;**${pct}%**\n\n`);
    appendLimits(md, limits);
    md.appendMarkdown(`[Manage Nova AI](command:${COMMAND_MANAGE})`);
    return md;
}

function appendLimits(md: vscode.MarkdownString, limits: UsageLimit[]): void {
    for (const limit of limits) {
        const pct = Math.min(Math.round((limit.used / Math.max(limit.total, 1)) * 100), 100);
        md.appendMarkdown('---\n\n');
        md.appendMarkdown(`**${limit.label}**\n\n`);
        md.appendMarkdown(htmlProgressBar(pct));
        md.appendMarkdown(`\n\n${formatTokens(limit.used)} / ${formatTokens(limit.total)} tokens &nbsp;**${pct}%** used`);
        if (limit.resetAt) {
            md.appendMarkdown(` · Resets ${limit.resetAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
        }
        md.appendMarkdown('\n\n');
    }
}

function htmlProgressBar(pct: number): string {
    const fillColor = pct >= 90 ? '#e06c75' : pct >= 70 ? '#d4a55e' : '#4d9375';
    const total = 25;
    const filled = Math.round((pct / 100) * total);
    const empty = total - filled;
    return (
        (filled > 0 ? `<span style="color:${fillColor};">${'█'.repeat(filled)}</span>` : '') +
        (empty > 0 ? `<span style="color:#555555;">${'░'.repeat(empty)}</span>` : '')
    );
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function getContextWindow(model: LanguageModelInfo): number {
    return Math.max(1, model.maxInputTokens + model.maxOutputTokens);
}

function getUsageBackground(pct: number): vscode.ThemeColor | undefined {
    if (pct >= 90) return new vscode.ThemeColor('statusBarItem.errorBackground');
    if (pct >= 70) return new vscode.ThemeColor('statusBarItem.warningBackground');
    return undefined;
}

function newMd(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportHtml = true;
    return md;
}
