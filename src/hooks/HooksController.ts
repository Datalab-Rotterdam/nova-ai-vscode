import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ToolCatalogEntry } from '../panel/ChatController';
import type { PermissionService } from '../permissions/PermissionService';
import { displayLocation } from '../skills/SkillsController';
import { writePrivateFile } from '../storage/NovaHome';
import { addHook, listHooks, removeHook, scriptCommand } from './config';
import { HOOK_EVENTS, type HookEvent } from './HookService';
import type { HookRef, HookRow, HookScopeName, HooksCommand, HooksPageData } from './protocol';

/**
 * The extension side of the Hooks page: lists the hooks of every settings file and adds or
 * removes them, with VS Code's own pickers. New workspace hooks go to the shared
 * `.nova-ai/settings.json` (committed, for the team), new user hooks to `~/.nova-ai/settings.json`.
 */
export class HooksController implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private watchers: vscode.Disposable[] = [];
    private refreshTimer?: ReturnType<typeof setTimeout>;

    public constructor(
        private readonly permissions: PermissionService,
        private readonly catalog: () => ToolCatalogEntry[],
        private readonly post: (message: { type: 'hooks'; data: HooksPageData }) => void
    ) {
        this.watch();
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.watch();
                this.scheduleRefresh();
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() => void this.refresh())
        );
    }

    public dispose(): void {
        clearTimeout(this.refreshTimer);
        this.disposables.forEach((disposable) => disposable.dispose());
        this.watchers.forEach((watcher) => watcher.dispose());
    }

    public async handle(message: HooksCommand): Promise<void> {
        switch (message.command) {
            case 'hooks/ready':
                break;
            case 'hooks/create':
                await this.create(message.scope);
                break;
            case 'hooks/open':
                await this.reveal(this.known(message.file), message.command);
                return;
            case 'hooks/delete':
                await this.delete(message);
                break;
            case 'hooks/openFile':
                await this.reveal(this.target(message.scope));
                return;
        }
        await this.refresh();
    }

    public async refresh(): Promise<void> {
        const roots = this.roots();
        const files = this.permissions.settingsFiles();
        const hooks: HookRow[] = [];
        for (const { file, workspace, kind } of files) {
            for (const entry of listHooks(await readOrEmpty(file).catch(() => undefined))) {
                hooks.push({ ...entry, scope: workspace ? 'workspace' : 'user', kind, file, location: displayLocation(file, { workspaceRoots: roots }) });
            }
        }
        const shared = files.find((candidate) => candidate.kind === 'shared');
        this.post({
            type: 'hooks',
            data: {
                hooks,
                hasProject: !!shared,
                trusted: vscode.workspace.isTrusted,
                files: {
                    user: displayLocation(this.target('user'), { workspaceRoots: roots }),
                    ...(shared ? { workspace: displayLocation(shared.file, { workspaceRoots: roots }) } : {})
                }
            }
        });
    }

    /** Event, then the tools (for tool events), then a command or a script file. */
    private async create(scope: HookScopeName): Promise<void> {
        const file = this.target(scope);
        const event = await vscode.window.showQuickPick(
            HOOK_EVENTS.map((candidate) => ({ label: candidate.name, detail: candidate.description, tool: candidate.tool })),
            { title: `New ${scope === 'user' ? 'User' : 'Workspace'} Hook`, placeHolder: 'When should the hook run?', matchOnDetail: true, ignoreFocusOut: true }
        );
        if (!event) {
            return;
        }
        let matcher: string | undefined;
        if (event.tool) {
            const all = { label: '$(check-all) All tools', value: '' };
            const custom = { label: '$(regex) Custom pattern…', detail: 'A regular expression over the tool name, e.g. edit_file|create_file or mcp__github__.*', value: undefined };
            const picked = await vscode.window.showQuickPick(
                [all, custom, { kind: vscode.QuickPickItemKind.Separator, label: 'Tools', value: '' }, ...this.catalog().map((tool) => ({ label: tool.name, detail: tool.description, value: tool.name }))],
                { title: `New ${event.label} Hook (2/3)`, placeHolder: 'Which tools?', matchOnDetail: true, ignoreFocusOut: true }
            );
            if (!picked) {
                return;
            }
            matcher = picked.value ?? await vscode.window.showInputBox({
                title: `New ${event.label} Hook (2/3)`,
                prompt: 'A regular expression over the whole tool name. Claude Code\'s names (Bash, Edit, Write…) work too.',
                placeHolder: 'edit_file|create_file',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    try {
                        new RegExp(value);
                        return value.trim() ? undefined : 'Type a pattern, or pick All tools.';
                    } catch {
                        return 'Not a valid regular expression.';
                    }
                }
            });
            if (matcher === undefined) {
                return;
            }
        }
        const title = `New ${event.label} Hook (${event.tool ? '3/3' : '2/2'})`;
        const kind = await vscode.window.showQuickPick([
            { label: '$(terminal) Command…', detail: 'Any command line, e.g. npm test or git status --short', script: false },
            { label: '$(file-code) Script file…', detail: 'Pick a file; Nova runs it with node, python3, bash or pwsh by its extension', script: true }
        ], { title, placeHolder: 'What should it run?', ignoreFocusOut: true });
        if (!kind) {
            return;
        }
        let value: string | undefined;
        if (kind.script) {
            const root = this.workspaceRoot();
            const [script] = await vscode.window.showOpenDialog({
                title: 'Script to run',
                defaultUri: vscode.Uri.file(scope === 'workspace' && root ? root : os.homedir()),
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false
            }) ?? [];
            if (!script) {
                return;
            }
            value = scriptCommand(script.fsPath, root);
        }
        // The command box also shows a picked script's command, to add arguments.
        const command = await vscode.window.showInputBox({
            title,
            prompt: 'Runs in the workspace folder and gets the event as JSON on stdin. Exit code 2 blocks; stderr says why.',
            placeHolder: PLACEHOLDERS[event.label as HookEvent],
            value,
            ignoreFocusOut: true,
            validateInput: (input) => input.trim() ? undefined : 'Type the command to run.'
        });
        if (!command?.trim()) {
            return;
        }
        await writeSettings(file, addHook(await readOrEmpty(file), event.label, matcher || undefined, command.trim()), scope === 'workspace');
        await this.reveal(file, command.trim());
    }

    private async delete(ref: HookRef): Promise<void> {
        const file = this.known(ref.file);
        const answer = await vscode.window.showWarningMessage(
            `Delete the ${ref.event} hook "${ref.command}"?`,
            { modal: true, detail: `It is removed from ${displayLocation(file, { workspaceRoots: this.roots() })}.` },
            'Delete'
        );
        if (answer !== 'Delete') {
            return;
        }
        const settings = await readOrEmpty(file);
        // The file may have changed since the page showed it: only remove the hook that is still there.
        if (!listHooks(settings).some((entry) => entry.event === ref.event && entry.group === ref.group && entry.index === ref.index && entry.command === ref.command)) {
            throw new Error('That hook changed in the settings file. Look again and retry.');
        }
        await writeSettings(file, removeHook(settings, ref.event, ref.group, ref.index), this.isWorkspace(file));
    }

    /** Opens the settings file, with the command selected when given. */
    private async reveal(file: string, command?: string): Promise<void> {
        const exists = await fs.access(file).then(() => true, () => false);
        // A file that doesn't exist yet opens unsaved, so looking doesn't create it.
        const editor = await vscode.window.showTextDocument(vscode.Uri.file(file).with({ scheme: exists ? 'file' : 'untitled' }), { preview: false });
        // ponytail: finds the first match; the same command twice in one file selects the first.
        const at = command ? editor.document.getText().indexOf(JSON.stringify(command)) : -1;
        if (at >= 0) {
            const range = new vscode.Range(editor.document.positionAt(at), editor.document.positionAt(at + JSON.stringify(command).length));
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    /** Where new hooks of a scope go. */
    private target(scope: HookScopeName): string {
        const file = this.permissions.settingsFiles().find((candidate) => candidate.kind === (scope === 'user' ? 'user' : 'shared'))?.file;
        if (!file) {
            throw new Error('Open a folder in VS Code to add hooks for it.');
        }
        return file;
    }

    /** Only the settings files Nova reads may be opened or changed from the page. */
    private known(file: string): string {
        if (!this.permissions.settingsFiles().some((candidate) => candidate.file === file)) {
            throw new Error('That settings file is not used here.');
        }
        return file;
    }

    private workspaceRoot(): string | undefined {
        const shared = this.permissions.settingsFiles().find((candidate) => candidate.kind === 'shared');
        return shared && path.dirname(path.dirname(shared.file));
    }

    private isWorkspace(file: string): boolean {
        return this.permissions.settingsFiles().some((candidate) => candidate.file === file && candidate.workspace);
    }

    private roots(): string[] {
        return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
    }

    /** The settings files can change outside the page (editor, git, CLI). */
    private watch(): void {
        this.watchers.forEach((watcher) => watcher.dispose());
        this.watchers = this.permissions.settingsFiles().map(({ file }) => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
            const changed = () => this.scheduleRefresh();
            watcher.onDidChange(changed);
            watcher.onDidCreate(changed);
            watcher.onDidDelete(changed);
            return watcher;
        });
    }

    private scheduleRefresh(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 300);
    }
}

/** A hint in the command box: something that fits the event. */
const PLACEHOLDERS: Record<HookEvent, string> = {
    SessionStart: 'git status --short',
    UserPromptSubmit: 'git branch --show-current',
    PreToolUse: 'node .nova-ai/hooks/check-command.js',
    PostToolUse: 'npm run lint --silent',
    PreCompact: 'git stash list',
    SubagentStart: 'git log --oneline -5',
    SubagentStop: 'npm test --silent',
    Stop: 'npm test --silent'
};

/** A missing file is empty; a file that isn't valid JSON is never overwritten. */
async function readOrEmpty(file: string): Promise<Record<string, unknown>> {
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${file} is not valid JSON. Fix it first; Nova does not overwrite it.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${file} does not hold a JSON object. Fix it first; Nova does not overwrite it.`);
    }
    return parsed as Record<string, unknown>;
}

/** The workspace's file is committed for the team, so not private like the user's files. */
async function writeSettings(file: string, settings: Record<string, unknown>, workspace: boolean): Promise<void> {
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    if (workspace) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
    } else {
        await writePrivateFile(file, text);
    }
}
