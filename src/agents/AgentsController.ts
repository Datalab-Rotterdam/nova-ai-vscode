import * as path from 'node:path';
import * as vscode from 'vscode';
import { displayLocation } from '../skills/SkillsController';
import { ensureDir, writePrivateFile } from '../storage/NovaHome';
import { agentIdOf, agentTemplate, listAgents, type AgentPaths } from './AgentService';
import type { AgentRow, AgentScopeName, AgentsCommand, AgentsPageData } from './protocol';

/** Where agents of a scope are kept, if there is such a scope (no project without a folder). */
export function agentsFolder(paths: AgentPaths, scope: AgentScopeName): string | undefined {
    const base = scope === 'global' ? paths.novaHome : paths.projectDir;
    return base ? path.join(base, 'agents') : undefined;
}

/** Asks for a name and creates an agent file from the template; returns its path. */
export async function createAgentFile(paths: AgentPaths, scope: AgentScopeName): Promise<string | undefined> {
    const folder = agentsFolder(paths, scope);
    if (!folder) {
        void vscode.window.showWarningMessage('Open a folder to create a project agent.');
        return undefined;
    }
    const taken = new Set(listAgents(paths).map((agent) => `${agent.source === 'builtin' ? 'builtin' : agent.source}:${agent.id}`));
    const name = await vscode.window.showInputBox({
        title: `New ${scope === 'global' ? 'Global' : 'Project'} Agent`,
        prompt: 'Name of the agent (becomes the file name)',
        placeHolder: 'Code Reviewer',
        ignoreFocusOut: true,
        validateInput: (value) => {
            const id = agentIdOf(value);
            if (!id) {
                return 'Enter a name.';
            }
            if (taken.has(`builtin:${id}`) || id === 'interactive') {
                return `"${id}" is a built-in agent and cannot be replaced.`;
            }
            return taken.has(`${scope}:${id}`) ? `There is already a ${scope} agent "${id}".` : undefined;
        }
    });
    if (!name?.trim()) {
        return undefined;
    }
    const file = path.join(folder, `${agentIdOf(name)}.agent.md`);
    await ensureDir(folder);
    await writePrivateFile(file, agentTemplate(name.trim()));
    return file;
}

/**
 * The extension side of the Agents page: answers its commands (with VS Code's own input
 * boxes and confirmations) and sends it the current list, also when agent files change on disk.
 */
export class AgentsController implements vscode.Disposable {
    private watchers: vscode.Disposable[] = [];
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private readonly workspaceListener: vscode.Disposable;

    public constructor(
        private readonly paths: () => AgentPaths,
        private readonly post: (message: { type: 'agents'; data: AgentsPageData }) => void
    ) {
        this.watch();
        this.workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.watch();
            this.scheduleRefresh();
        });
    }

    public dispose(): void {
        clearTimeout(this.refreshTimer);
        this.workspaceListener.dispose();
        this.watchers.forEach((watcher) => watcher.dispose());
    }

    public async handle(message: AgentsCommand): Promise<void> {
        switch (message.command) {
            case 'agents/ready':
                break;
            case 'agents/create': {
                const file = await createAgentFile(this.paths(), message.scope);
                if (file) {
                    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
                }
                break;
            }
            case 'agents/open': {
                const agent = this.known(message.path);
                await vscode.window.showTextDocument(vscode.Uri.file(agent.path!), { preview: agent.source !== 'builtin' });
                if (agent.source === 'builtin') {
                    // Bundled with the extension: shown, never changed.
                    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
                }
                return;
            }
            case 'agents/reveal':
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.known(message.path).path!));
                return;
            case 'agents/delete':
                await this.delete(message.path);
                break;
            case 'agents/openFolder': {
                const folder = agentsFolder(this.paths(), message.scope);
                if (folder) {
                    await ensureDir(folder);
                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
                }
                return;
            }
        }
        this.refresh();
    }

    /** Sends the current list to the page. */
    public refresh(): void {
        const paths = this.paths();
        const roots = { workspaceRoots: [] as string[] };
        this.post({
            type: 'agents',
            data: {
                agents: listAgents(paths).filter((agent) => agent.selectable).map((agent): AgentRow => ({
                    id: agent.id,
                    name: agent.name,
                    description: agent.description,
                    icon: agent.icon,
                    ...(agent.path ? { path: agent.path, location: displayLocation(path.dirname(agent.path), roots) } : { location: 'Built in' }),
                    source: agent.source,
                    ...(agent.tools ? { tools: agent.tools } : {}),
                    readOnly: agent.readOnly,
                    autopilot: agent.autopilot,
                    selectable: agent.selectable
                })),
                hasProject: Boolean(paths.projectDir),
                folders: {
                    global: displayLocation(agentsFolder(paths, 'global')!, roots),
                    ...(paths.projectDir ? { project: displayLocation(agentsFolder(paths, 'project')!, roots) } : {})
                }
            }
        });
    }

    private async delete(file: string): Promise<void> {
        const agent = this.known(file);
        if (agent.source === 'builtin') {
            void vscode.window.showInformationMessage(`"${agent.name}" is built in and cannot be deleted.`);
            return;
        }
        const answer = await vscode.window.showWarningMessage(
            `Delete the agent "${agent.name}"?`,
            { modal: true, detail: `${agent.path} goes to the trash.` },
            'Delete'
        );
        if (answer === 'Delete') {
            await vscode.workspace.fs.delete(vscode.Uri.file(agent.path!), { useTrash: true });
        }
    }

    /** Only files of agents that were found may be opened or deleted. */
    private known(file: string) {
        const agent = listAgents(this.paths()).find((candidate) => candidate.path === file);
        if (!agent?.path) {
            throw new Error('That agent no longer exists.');
        }
        return agent;
    }

    /** Agent folders can change outside the page (editor, git, CLI). */
    private watch(): void {
        this.watchers.forEach((watcher) => watcher.dispose());
        const paths = this.paths();
        const folders = [agentsFolder(paths, 'global'), agentsFolder(paths, 'project')].filter((folder): folder is string => Boolean(folder));
        this.watchers = folders.map((folder) => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '*.md'));
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
