import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureDir } from '../storage/NovaHome';

/**
 * Tool permission rules, in the style of Claude Code's `.claude/settings.json`:
 *
 * ```json
 * { "permissions": { "allow": ["run_command(npm test*)", "edit_file"], "deny": ["run_command(rm -rf*)"] } }
 * ```
 *
 * A rule is a tool name, optionally with a `*` glob matched against the call's subject:
 * the command for `run_command`, the URL for `fetch_url`, the path for file tools.
 *
 * Sources, all merged:
 * - `~/.nova-ai/settings.json` (the user's own),
 * - `<workspace>/.nova-ai/settings.json` (team-shared, committed),
 * - `<workspace>/.nova-ai/settings.local.json` (personal, gitignored; "Always allow" writes here).
 *
 * Deny rules always win. Allow rules from the workspace only apply in a trusted workspace,
 * so a cloned repository cannot approve its own commands.
 */
export class PermissionService {
    public constructor(
        private readonly globalSettings: string,
        private readonly workspaceRoot: () => string | undefined = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        private readonly isTrusted: () => boolean = () => vscode.workspace.isTrusted
    ) {
    }

    public async decide(tool: string, subject: string | undefined): Promise<'allow' | 'deny' | undefined> {
        const rules = await this.rules();
        if (rules.deny.some((rule) => matches(rule, tool, subject))) {
            return 'deny';
        }
        if (rules.allow.some((rule) => matches(rule, tool, subject))) {
            return 'allow';
        }
        return undefined;
    }

    /** Adds an allow rule to the workspace's settings.local.json (or the global file without a workspace). */
    public async allow(rule: string): Promise<string> {
        const root = this.workspaceRoot();
        const file = root ? path.join(root, '.nova-ai', 'settings.local.json') : this.globalSettings;
        if (root) {
            await ensureGitignore(path.join(root, '.nova-ai'));
        }

        const settings = await readSettings(file) ?? {};
        const permissions = (settings.permissions ??= {});
        const allow = (permissions.allow ??= []);
        if (!allow.includes(rule)) {
            allow.push(rule);
        }
        await ensureDir(path.dirname(file));
        await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
        return file;
    }

    public async rules(): Promise<{ allow: string[]; deny: string[] }> {
        const root = this.workspaceRoot();
        const user = await readSettings(this.globalSettings);
        const shared = root ? await readSettings(path.join(root, '.nova-ai', 'settings.json')) : undefined;
        const local = root ? await readSettings(path.join(root, '.nova-ai', 'settings.local.json')) : undefined;
        const trusted = this.isTrusted();

        return {
            allow: [
                ...list(user?.permissions?.allow),
                ...(trusted ? [...list(shared?.permissions?.allow), ...list(local?.permissions?.allow)] : [])
            ],
            deny: [...list(user?.permissions?.deny), ...list(shared?.permissions?.deny), ...list(local?.permissions?.deny)]
        };
    }
}

interface NovaSettings {
    permissions?: { allow?: string[]; deny?: string[] };
    [key: string]: unknown;
}

/** Suggests the rule an "Always allow" click should add for a tool call. */
export function suggestRule(tool: string, subject: string | undefined): string {
    if (tool === 'run_command' && subject) {
        return `run_command(${subject})`;
    }
    if (tool === 'fetch_url' && subject) {
        try {
            const url = new URL(subject);
            return `fetch_url(${url.protocol}//${url.host}/*)`;
        } catch {
            return 'fetch_url';
        }
    }
    return tool;
}

/** `tool` matches every call of the tool; `tool(glob)` matches when the subject matches the glob. */
export function matches(rule: string, tool: string, subject: string | undefined): boolean {
    const parsed = /^\s*([\w.-]+)\s*(?:\((.*)\))?\s*$/s.exec(rule);
    if (!parsed || parsed[1] !== tool) {
        return false;
    }
    const pattern = parsed[2];
    if (pattern === undefined) {
        return true;
    }
    if (subject === undefined) {
        return false;
    }
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 's');
    return regex.test(subject.trim());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** Keeps personal settings out of git. */
async function ensureGitignore(dir: string): Promise<void> {
    const file = path.join(dir, '.gitignore');
    await ensureDir(dir);
    let content = '';
    try {
        content = await fs.readFile(file, 'utf8');
    } catch {
        // new
    }
    if (!content.split(/\r?\n/).includes('settings.local.json')) {
        await fs.writeFile(file, `${content}${content && !content.endsWith('\n') ? '\n' : ''}settings.local.json\n`);
    }
}
