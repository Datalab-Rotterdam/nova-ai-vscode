/** Messages between the Tools section (webview) and the extension. Type-only: the webview imports it. */

export type ToolScopeName = 'user' | 'project';

export interface ToolRow {
    name: string;
    description: string;
    readOnly: boolean;
    /** Used in chats: not switched off in the shown scope or by the other one. */
    enabled: boolean;
    /** Switched off by the user's settings while the project scope is shown, or the other way round. */
    inherited: boolean;
}

/** A group of tools, such as "Integrated Browser"; groups are listed under a category. */
export interface ToolGroup {
    /** "Built-in Tools", "VS Code Tools", "Connected Sources". */
    category: string;
    title: string;
    description: string;
    tools: ToolRow[];
}

export interface ToolsPageData {
    scope: ToolScopeName;
    hasProject: boolean;
    groups: ToolGroup[];
}

export type ToolsCommand =
    | { command: 'tools/ready' }
    | { command: 'tools/scope'; scope: ToolScopeName }
    | { command: 'tools/set'; names: string[]; enabled: boolean };
