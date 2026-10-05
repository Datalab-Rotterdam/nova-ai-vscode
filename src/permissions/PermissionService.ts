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

    public async rules(): Promise<{ allow: string[]; deny: string[] }> {
        const root = this.workspaceRoot();
        const project = this.projectSettings();
        const user = await readSettings(this.globalSettings);
        const own = project ? await readSettings(project) : undefined;
        const shared = root ? await readSettings(path.join(root, '.nova-ai', 'settings.json')) : undefined;
        const local = root ? await readSettings(path.join(root, '.nova-ai', 'settings.local.json')) : undefined;
        const trusted = this.isTrusted();

        return {
            allow: [
                ...list(user?.permissions?.allow),
                ...list(own?.permissions?.allow),
                ...(trusted ? [...list(shared?.permissions?.allow), ...list(local?.permissions?.allow)] : [])
            ],
            deny: [
                ...list(user?.permissions?.deny),
                ...list(own?.permissions?.deny),
                ...list(shared?.permissions?.deny),
                ...list(local?.permissions?.deny)
            ]
        };
    }
}

interface NovaSettings {
    permissions?: { allow?: string[]; deny?: string[] };
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

async function readSettings(file: string): Promise<NovaSettings | undefined> {
    try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
        return typeof parsed === 'object' && parsed !== null ? parsed as NovaSettings : undefined;
    } catch {
        return undefined;
    }
}
