import * as vscode from 'vscode';
import type { ToolCatalogEntry } from '../panel/ChatController';
import type { PermissionService } from '../permissions/PermissionService';
import type { ToolGroup, ToolRow, ToolScopeName, ToolsCommand, ToolsPageData } from './protocol';

/**
 * The extension side of the Tools section: lists the tools a chat can use, by group, and
 * switches tools on and off for the user or for the project (see PermissionService.disabledTools).
 */
export class ToolsController implements vscode.Disposable {
    private scope: ToolScopeName = 'user';
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly catalog: () => ToolCatalogEntry[],
        private readonly permissions: PermissionService,
        private readonly hasProject: () => boolean,
        private readonly post: (message: { type: 'tools'; data: ToolsPageData }) => void,
        onChange?: vscode.Event<unknown>
    ) {
        if (onChange) {
            this.disposables.push(onChange(() => void this.refresh()));
        }
    }

    public dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
    }

    public async handle(message: ToolsCommand): Promise<void> {
        switch (message.command) {
            case 'tools/ready':
                break;
            case 'tools/scope':
                this.scope = message.scope === 'project' && this.hasProject() ? 'project' : 'user';
                break;
            case 'tools/set':
                await this.permissions.setToolsEnabled(message.names, message.enabled, this.scope);
                break;
        }
        await this.refresh();
    }

    public async refresh(): Promise<void> {
        const scope = this.scope === 'project' && !this.hasProject() ? 'user' : this.scope;
        const shown = await this.permissions.toolSwitches(scope);
        const effective = await this.permissions.disabledTools();
        const groups = new Map<string, ToolGroup>();
        for (const entry of this.catalog()) {
            const here = scope === 'user' ? shown.disabled.includes(entry.name) : effective.has(entry.name);
            const row: ToolRow = {
                name: entry.name,
                description: entry.description,
                readOnly: entry.readOnly,
                enabled: !here,
                // The project view shows what the user turned off; the user view shows what a project turned off.
                inherited: scope === 'project' ? effective.has(entry.name) && !shown.disabled.includes(entry.name) : false
            };
            const key = `${entry.category}\n${entry.group}`;
            const group = groups.get(key) ?? { category: entry.category, title: entry.group, description: entry.groupDescription, tools: [] };
            groups.set(key, group);
            group.tools.push(row);
        }
        const order = (category: string) => ['Built-in Tools', 'VS Code Tools', 'Connected Sources'].indexOf(category);
        const list = [...groups.values()].sort((a, b) => order(a.category) - order(b.category));
        this.post({ type: 'tools', data: { scope, hasProject: this.hasProject(), groups: list } });
    }
}
