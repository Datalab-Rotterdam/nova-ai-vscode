import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { writePrivateFile } from '../storage/NovaHome';
import { evaluatePermissionRules, exactPermissionRule } from './rules';
import * as path from 'node:path';

/**
 * Tool permission rules, in the style of Claude Code's `.claude/settings.json`, shared with
 * nova-ai-cli (docs/NOVA_HOME.md, "Settings and trust"):
 *
 * ```json
 * { "permissions": { "allow": ["run_command(npm test)", "edit_file(src/*)"], "deny": ["run_command(rm *)"] } }
 * ```
 *
 * A rule is a tool name, optionally with a glob matched against the call's subject: the
 * command for `run_command` (checked per command segment, see rules.ts), the URL for
 * `fetch_url`, the workspace-relative path for file tools.
 *
 * Sources, all merged:
 * - `~/.nova-ai/settings.json` (the user's own),
 * - `~/.nova-ai/projects/<key>/settings.json` (private to the user; "Always allow" writes here),
 * - `<workspace>/.nova-ai/settings.json` (team-shared, committed),
 * - `<workspace>/.nova-ai/settings.local.json` (personal, gitignored; written by older versions).
 *
 * Deny rules always win. Allow rules from the workspace only apply in a trusted workspace,
 * so a cloned repository cannot approve its own commands.
 */
export class PermissionService {
    public constructor(
        private readonly globalSettings: string,
        private readonly workspaceRoot: () => string | undefined = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        private readonly isTrusted: () => boolean = () => vscode.workspace.isTrusted,
        private readonly projectSettings: () => string | undefined = () => undefined
    ) {
    }

    /** Decides a call from its tool name and full input; undefined when the user must be asked. */
    public async decide(tool: string, input: Record<string, unknown>): Promise<'allow' | 'deny' | undefined> {
        const decision = evaluatePermissionRules(await this.rules(), tool, input, this.workspaceRoot());
        return decision === 'ask' ? undefined : decision;
    }

    /** Adds an allow rule to the private per-project settings (or the global file without a project). */
    public async allow(rule: string): Promise<string> {
        const file = this.projectSettings() ?? this.globalSettings;
        const settings = await readSettings(file) ?? {};
        const permissions = (settings.permissions ??= {});
        const allow = (permissions.allow ??= []);
        if (!allow.includes(rule)) {
            allow.push(rule);
        }
        await writePrivateFile(file, `${JSON.stringify(settings, null, 2)}\n`);
        return file;
    }

    /**
     * Tools switched off on the Tools page. The user's file and the private project file each
     * hold `disabledTools` and `enabledTools`; the project's entries win over the user's.
     */
    public async disabledTools(): Promise<Set<string>> {
        const user = await readSettings(this.globalSettings);
        const projectFile = this.projectSettings();
        const project = projectFile ? await readSettings(projectFile) : undefined;
        const disabled = new Set(list(user?.disabledTools));
        for (const name of list(project?.enabledTools)) {
            disabled.delete(name);
        }
        for (const name of list(project?.disabledTools)) {
            disabled.add(name);
        }
        return disabled;
    }

    /** What one scope says about tools: names it switches off and names it switches back on. */
    public async toolSwitches(scope: 'user' | 'project'): Promise<{ disabled: string[]; enabled: string[] }> {
        const file = scope === 'user' ? this.globalSettings : this.projectSettings();
        const settings = file ? await readSettings(file) : undefined;
        return { disabled: list(settings?.disabledTools), enabled: list(settings?.enabledTools) };
    }

    public async setToolsEnabled(names: readonly string[], enabled: boolean, scope: 'user' | 'project'): Promise<void> {
        const file = scope === 'user' ? this.globalSettings : this.projectSettings();
        if (!file) {
            throw new Error('Open a folder to change the tools of a project.');
        }
        const settings = await readSettings(file) ?? {};
        const disabled = new Set(list(settings.disabledTools));
        const enabledHere = new Set(list(settings.enabledTools));
        const userDisabled = scope === 'project' ? new Set(list((await readSettings(this.globalSettings))?.disabledTools)) : new Set<string>();
        for (const name of names) {
            if (enabled) {
                disabled.delete(name);
                // A project can switch on what the user switched off.
                userDisabled.has(name) ? enabledHere.add(name) : enabledHere.delete(name);
            } else {
                enabledHere.delete(name);
                disabled.add(name);
            }
        }
        settings.disabledTools = [...disabled];
        settings.enabledTools = [...enabledHere];
        await writePrivateFile(file, `${JSON.stringify(settings, null, 2)}\n`);
    }

    public async rules(): Promise<{ allow: string[]; deny: string[] }> {
        const sources = await this.sources();
        const trusted = this.isTrusted();
        return {
            allow: sources.filter((source) => !source.workspace || trusted).flatMap((source) => list(source.settings.permissions?.allow)),
            deny: sources.flatMap((source) => list(source.settings.permissions?.deny))
        };
    }

    /**
     * Hooks of all settings files, per event (see HookService). Like allow rules, a
     * workspace's hooks only count in a trusted workspace: a hook runs any command.
     */
    public async hooks(): Promise<Record<string, unknown[]>> {
        const trusted = this.isTrusted();
        const merged: Record<string, unknown[]> = {};
        for (const source of await this.sources()) {
            const hooks = source.settings.hooks;
            if ((source.workspace && !trusted) || !hooks || typeof hooks !== 'object') {
                continue;
            }
            for (const [event, matchers] of Object.entries(hooks)) {
                if (Array.isArray(matchers)) {
                    (merged[event] ??= []).push(...matchers);
                }
            }
        }
        return merged;
    }

    /**
     * The settings files in order: the user's, the private project file, then the workspace's
     * two. `workspace`: in the repository, so only trusted in a trusted workspace.
     */
    public settingsFiles(): Array<{ file: string; workspace: boolean; kind: 'user' | 'project' | 'shared' | 'local' }> {
        const root = this.workspaceRoot();
        const project = this.projectSettings();
        return [
            { file: this.globalSettings, workspace: false, kind: 'user' as const },
            ...(project ? [{ file: project, workspace: false, kind: 'project' as const }] : []),
            ...(root ? [
                { file: path.join(root, '.nova-ai', 'settings.json'), workspace: true, kind: 'shared' as const },
                { file: path.join(root, '.nova-ai', 'settings.local.json'), workspace: true, kind: 'local' as const }
            ] : [])
        ];
    }

    private async sources(): Promise<Array<{ settings: NovaSettings; workspace: boolean }>> {
        const sources: Array<{ settings: NovaSettings; workspace: boolean }> = [];
        for (const { file, workspace } of this.settingsFiles()) {
            const settings = await readSettings(file);
            if (settings) {
                sources.push({ settings, workspace });
            }
        }
        return sources;
    }
}

interface NovaSettings {
    permissions?: { allow?: string[]; deny?: string[] };
    hooks?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * The rule an "Always allow" click should add: for fetch_url the whole site, otherwise the
 * exact call (an exact command line, a workspace-relative path), so approving one command
 * never approves others.
 */
export function suggestRule(tool: string, input: Record<string, unknown>, workspaceRoot?: string): string {
    if (tool === 'fetch_url' && typeof input.url === 'string') {
        try {
            const url = new URL(input.url.trim());
            return `fetch_url(${url.protocol}//${url.host}/*)`;
        } catch {
            return 'fetch_url';
        }
    }
    return exactPermissionRule(tool, input, workspaceRoot);
}

function list(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function readSettings(file: string): Promise<NovaSettings | undefined> {
    try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
        return typeof parsed === 'object' && parsed !== null ? parsed as NovaSettings : undefined;
    } catch {
        return undefined;
    }
}
