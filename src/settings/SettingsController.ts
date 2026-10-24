import * as vscode from 'vscode';
import { MODEL_SETTINGS, type ModelChoice } from '../model/modelSettings';
import type { SettingControl, SettingOption, SettingRow, SettingsCommand, SettingsPageData, SettingsScope } from './protocol';

interface PropertySchema {
    type?: string | string[];
    enum?: string[];
    enumDescriptions?: string[];
    markdownEnumDescriptions?: string[];
    items?: { type?: string; enum?: string[] };
    minimum?: number;
    maximum?: number;
    default?: unknown;
    description?: string;
    markdownDescription?: string;
    scope?: string;
    order?: number;
    deprecationMessage?: string;
    markdownDeprecationMessage?: string;
}

interface ConfigurationSection {
    id: string;
    title: string;
    order?: number;
    properties?: Record<string, PropertySchema>;
}

/** Words that should not be title-cased from a setting key. */
const WORDS: Record<string, string> = { mcp: 'MCP', url: 'URL', ms: 'ms', duckduckgo: 'DuckDuckGo', you: 'You.com', searxng: 'SearXNG', claude: 'Claude', codex: 'Codex' };

/**
 * The extension side of the Nova Settings page. Its sections and controls come from the
 * settings this extension contributes (package.json), so the page and VS Code's settings never
 * drift; model settings list the models. Values are ordinary VS Code settings, saved in User or
 * Workspace, so Settings Sync and settings.json keep working.
 */
export class SettingsController implements vscode.Disposable {
    private scope: SettingsScope = 'user';
    private readonly disposables: vscode.Disposable[];

    public constructor(
        private readonly sections: () => ConfigurationSection[],
        private readonly models: (kind: 'chat' | 'embedding') => Promise<ModelChoice[]>,
        private readonly post: (message: { type: 'settings'; data: SettingsPageData }) => void,
        onModelsChanged?: vscode.Event<unknown>
    ) {
        this.disposables = [
            vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration('nova') && void this.refresh()),
            ...(onModelsChanged ? [onModelsChanged(() => void this.refresh())] : [])
        ];
    }

    public async handle(command: SettingsCommand): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const target = this.scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        switch (command.command) {
            case 'settings/ready':
                break;
            case 'settings/scope':
                this.scope = command.scope === 'workspace' && vscode.workspace.workspaceFolders?.length ? 'workspace' : 'user';
                break;
            case 'settings/set':
                if (this.knows(command.key)) {
                    await config.update(command.key, command.value, target);
                }
                return;
            case 'settings/reset':
                if (this.knows(command.key)) {
                    await config.update(command.key, undefined, target);
                }
                return;
            case 'settings/openJson':
                await vscode.commands.executeCommand(this.scope === 'workspace' ? 'workbench.action.openWorkspaceSettingsFile' : 'workbench.action.openSettingsJson');
                return;
            case 'settings/openVsCode':
                await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:datalabrotterdam.nova-ai-vscode');
                return;
        }
        await this.refresh();
    }

    public async refresh(): Promise<void> {
        this.post({ type: 'settings', data: await this.data() });
    }

    public dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
    }

    private knows(key: string): boolean {
        return this.sections().some((section) => key in (section.properties ?? {}));
    }

    private async data(): Promise<SettingsPageData> {
        const config = vscode.workspace.getConfiguration();
        const chat = await this.models('chat').catch(() => []);
        const embedding = await this.models('embedding').catch(() => []);
        const sections = [...this.sections()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).map((section) => ({
            id: section.id,
            title: section.title,
            rows: Object.entries(section.properties ?? {})
                .filter(([, schema]) => !schema.deprecationMessage && !schema.markdownDeprecationMessage)
                .sort(([, left], [, right]) => (left.order ?? 0) - (right.order ?? 0))
                .map(([key, schema]) => this.row(config, key, schema, { chat, embedding }))
        }));
        return { scope: this.scope, hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length), sections };
    }

    private row(config: vscode.WorkspaceConfiguration, key: string, schema: PropertySchema, models: Record<'chat' | 'embedding', ModelChoice[]>): SettingRow {
        const inspected = config.inspect(key);
        const userOnly = schema.scope === 'machine' || schema.scope === 'application';
        const workspace = this.scope === 'workspace' && !userOnly;
        const defaultValue = inspected?.defaultValue ?? schema.default;
        const userValue = inspected?.globalValue;
        const workspaceValue = inspected?.workspaceValue;
        const { control, options } = controlFor(key, schema, models);
        return {
            key,
            label: labelOf(key),
            description: (schema.markdownDescription ?? schema.description ?? '').replace(/\s*\[[^\]]*\]\(command:[^)]*\)/g, ''),
            control,
            ...(options ? { options } : {}),
            ...(schema.minimum !== undefined ? { min: schema.minimum } : {}),
            ...(schema.maximum !== undefined ? { max: schema.maximum } : {}),
            ...(schema.type === 'integer' ? { integer: true } : {}),
            value: workspace ? workspaceValue ?? userValue ?? defaultValue : userValue ?? defaultValue,
            defaultValue,
            setHere: workspace ? workspaceValue !== undefined : userValue !== undefined,
            ...(!workspace && workspaceValue !== undefined ? { overridden: true } : {}),
            ...(userOnly ? { userOnly } : {})
        };
    }
}

function controlFor(key: string, schema: PropertySchema, models: Record<'chat' | 'embedding', ModelChoice[]>): { control: SettingControl; options?: SettingOption[] } {
    const model = MODEL_SETTINGS[key.replace(/^nova\./, '')];
    if (model) {
        const options = models[model.kind].map((choice) => ({ value: choice.id, label: choice.name, ...(choice.name !== choice.id ? { description: choice.id } : {}) }));
        return model.many
            ? { control: 'multi', options }
            : { control: 'model', options: [...(model.none ? [{ value: model.none.value, label: model.none.label }] : []), ...options] };
    }
    if (schema.enum) {
        const descriptions = schema.markdownEnumDescriptions ?? schema.enumDescriptions ?? [];
        return { control: 'enum', options: schema.enum.map((value, index) => ({ value, label: value, ...(descriptions[index] ? { description: descriptions[index] } : {}) })) };
    }
    if (schema.type === 'array' && schema.items?.enum) {
        return { control: 'multi', options: schema.items.enum.map((value) => ({ value, label: value })) };
    }
    switch (schema.type) {
        case 'boolean':
            return { control: 'boolean' };
        case 'number':
        case 'integer':
            return { control: 'number' };
        case 'string':
            return { control: 'text' };
        default:
            return { control: 'json' };
    }
}

/** `nova.agent.subagents.maxParallel` → "Max Parallel"; the section title gives the rest. */
export function labelOf(key: string): string {
    const last = key.split('.').pop() ?? key;
    return last
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(' ')
        .map((word) => WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
