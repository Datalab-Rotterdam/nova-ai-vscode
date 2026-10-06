import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureDir } from '../storage/NovaHome';
import type { SkillRow, SkillsCommand, SkillsPageData } from './protocol';
import {
    bundledMessage,
    createSkill,
    enabledSkills,
    moveSkill,
    novaSkillsFolder,
    SKILL_NAME_PATTERN,
    type SkillPaths,
    type SkillScope,
    skillRoots,
    skillViews,
    setSkillEnabled
} from './SkillService';
import { estimateSkillsPromptTokens } from './skillTools';

/**
 * The extension side of the Skills page: answers its commands (with VS Code's own input
 * boxes and confirmations) and sends it the current list, also when skill files or the
 * settings change on disk.
 */
export class SkillsController implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private refreshTimer?: ReturnType<typeof setTimeout>;

    public constructor(
        private readonly paths: () => SkillPaths,
        private readonly post: (message: { type: 'skills'; data: SkillsPageData }) => void
    ) {
        this.watch();
        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.watch();
            this.scheduleRefresh();
        }));
    }

    public dispose(): void {
        clearTimeout(this.refreshTimer);
        this.disposables.forEach((disposable) => disposable.dispose());
        this.watchers.forEach((watcher) => watcher.dispose());
    }

    public async handle(message: SkillsCommand): Promise<void> {
        switch (message.command) {
            case 'skills/ready':
                break;
            case 'skills/toggle':
                await setSkillEnabled(this.paths(), message.scope, message.name, message.enabled);
                break;
            case 'skills/create':
                await this.create(message.scope);
                break;
            case 'skills/open': {
                const skill = this.known(message.path);
                await vscode.window.showTextDocument(vscode.Uri.file(skill.path), { preview: !skill.bundled });
                if (skill.bundled) {
                    // Bundled skills are shown, never edited: updates would overwrite any change anyway.
                    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
                }
                return;
            }
            case 'skills/reveal':
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.known(message.path).path));
                return;
            case 'skills/move':
                await this.move(message.path, message.to);
                break;
            case 'skills/delete':
                await this.delete(message.path);
                break;
            case 'skills/openFolder':
                await this.openFolder(message.scope);
                return;
        }
        this.refresh();
    }

    /** Sends the current list to the page. */
    public refresh(): void {
        const paths = this.paths();
        const enabled = enabledSkills(paths);
        this.post({
            type: 'skills',
            data: {
                skills: skillViews(paths).map((skill): SkillRow => ({
                    name: skill.name,
                    description: skill.description,
                    path: skill.path,
                    location: displayLocation(skill.root, paths),
                    scope: skill.scope,
                    folder: skill.folder,
                    enabled: skill.enabled,
                    offGlobally: skill.offGlobally,
                    offInProject: skill.offInProject,
                    ...(skill.replacedBy ? { replacedBy: displayLocation(path.dirname(skill.replacedBy), paths) } : {}),
                    ...(skill.bundled ? { bundledBy: skill.bundled.bundledBy } : {})
                })),
                hasProject: paths.workspaceRoots.length > 0,
                folders: {
                    global: displayLocation(novaSkillsFolder(paths, 'global')!, paths),
                    ...(paths.workspaceRoots.length ? { project: displayLocation(novaSkillsFolder(paths, 'project')!, paths) } : {})
                },
                enabledCount: enabled.length,
                promptTokens: estimateSkillsPromptTokens(enabled)
            }
        });
    }

    private async create(scope: SkillScope): Promise<void> {
        const paths = this.paths();
        let workspaceRoot = paths.workspaceRoots[0];
        if (scope === 'project' && paths.workspaceRoots.length > 1) {
            const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Create the skill in which folder?' });
            if (!picked) {
                return;
            }
            workspaceRoot = picked.uri.fsPath;
        }
        const name = await vscode.window.showInputBox({
            title: `New ${scope === 'global' ? 'Global' : 'Project'} Skill (1/2)`,
            prompt: 'Name: lower-case letters, digits and dashes, e.g. release-notes',
            placeHolder: 'release-notes',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!SKILL_NAME_PATTERN.test(value.trim())) {
                    return 'Use lower-case letters, digits and dashes (at most 64), not starting or ending with a dash.';
                }
                return skillViews(paths).some((skill) => skill.name === value.trim() && skill.scope === scope)
                    ? `There is already a ${scope} skill named "${value.trim()}".`
                    : undefined;
            }
        });
        if (!name) {
            return;
        }
        const description = await vscode.window.showInputBox({
            title: `New ${scope === 'global' ? 'Global' : 'Project'} Skill (2/2)`,
            prompt: 'When should Nova use it? One sentence; Nova sees it in every chat to decide.',
            placeHolder: 'Write release notes from the merged pull requests',
            ignoreFocusOut: true
        });
        if (description === undefined) {
            return;
        }
        const file = await createSkill(paths, scope, name.trim(), description, workspaceRoot);
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
    }

    private async move(file: string, to: SkillScope): Promise<void> {
        const skill = this.known(file);
        if (skill.bundled) {
            void vscode.window.showInformationMessage(bundledMessage(skill));
            return;
        }
        const paths = this.paths();
        if (skill.folder !== 'nova') {
            const answer = await vscode.window.showWarningMessage(
                `Move "${skill.name}" to the ${to === 'global' ? 'global' : 'project'} Nova skills?`,
                { modal: true, detail: `It is in ${displayLocation(skill.root, paths)}, which other tools read too; after the move only Nova sees it.` },
                'Move'
            );
            if (answer !== 'Move') {
                return;
            }
        }
        const moved = await moveSkill(paths, skill, to);
        void vscode.window.showInformationMessage(`Moved "${skill.name}" to ${displayLocation(path.dirname(moved), paths)}.`);
    }

    private async delete(file: string): Promise<void> {
        const skill = this.known(file);
        if (skill.bundled) {
            void vscode.window.showInformationMessage(bundledMessage(skill));
            return;
        }
        const answer = await vscode.window.showWarningMessage(
            `Delete the skill "${skill.name}"?`,
            { modal: true, detail: `Its folder ${displayLocation(skill.root, this.paths())} goes to the trash.` },
            'Delete'
        );
        if (answer === 'Delete') {
            await vscode.workspace.fs.delete(vscode.Uri.file(skill.root), { recursive: true, useTrash: true });
        }
    }

    private async openFolder(scope: SkillScope): Promise<void> {
        const folder = novaSkillsFolder(this.paths(), scope);
        if (folder) {
            await ensureDir(folder);
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
        }
    }

    /** Only files of skills that were found may be opened, moved or deleted. */
    private known(file: string) {
        const skill = skillViews(this.paths()).find((candidate) => candidate.path === file);
        if (!skill) {
            throw new Error('That skill no longer exists.');
        }
        return skill;
    }

    private watchers: vscode.Disposable[] = [];

    /** Skill folders and settings files can change outside the page (editor, git, CLI). */
    private watch(): void {
        this.watchers.forEach((watcher) => watcher.dispose());
        const paths = this.paths();
        const patterns = [
            ...skillRoots(paths).map((root) => new vscode.RelativePattern(vscode.Uri.file(path.dirname(root.path)), 'skills/**')),
            new vscode.RelativePattern(vscode.Uri.file(paths.novaHome), 'settings.json'),
            ...(paths.projectSettings ? [new vscode.RelativePattern(vscode.Uri.file(path.dirname(paths.projectSettings)), 'settings.json')] : [])
        ];
        this.watchers = patterns.map((pattern) => {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const changed = () => this.scheduleRefresh();
            watcher.onDidChange(changed);
            watcher.onDidCreate(changed);
            watcher.onDidDelete(changed);
            return watcher;
        });
    }

    private scheduleRefresh(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh(), 300);
    }
}

/** "~/…" for the home folder, workspace-relative for project folders. */
export function displayLocation(target: string, paths: Pick<SkillPaths, 'workspaceRoots'>, home = os.homedir()): string {
    for (const root of paths.workspaceRoots) {
        const relative = path.relative(root, target);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
            return paths.workspaceRoots.length > 1 ? `${path.basename(root)}/${relative.split(path.sep).join('/')}` : relative.split(path.sep).join('/');
        }
    }
    const fromHome = path.relative(home, target);
    return fromHome && !fromHome.startsWith('..') && !path.isAbsolute(fromHome) ? `~/${fromHome.split(path.sep).join('/')}` : target;
}
