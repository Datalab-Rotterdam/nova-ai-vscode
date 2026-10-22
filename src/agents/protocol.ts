/** Messages between the Agents page (webview) and the extension. */

export type AgentScopeName = 'global' | 'project';

export interface AgentRow {
    id: string;
    name: string;
    description: string;
    /** Codicon name. */
    icon: string;
    /** Agent file; unset for Interactive, which is built in without a file. */
    path?: string;
    /** Folder shown to the user, e.g. "~/.nova-ai/agents". */
    location: string;
    /** Built-in agents are bundled with the extension: read-only. */
    source: 'builtin' | 'global' | 'project';
    /** Tool names the agent is limited to; unset: all tools. */
    tools?: string[];
    readOnly: boolean;
    autopilot: boolean;
    /** Shown in the chat's mode menu. */
    selectable: boolean;
}

export interface AgentsPageData {
    agents: AgentRow[];
    hasProject: boolean;
    folders: { global: string; project?: string };
}

export type AgentsCommand =
    | { command: 'agents/ready' }
    | { command: 'agents/create'; scope: AgentScopeName }
    | { command: 'agents/open'; path: string }
    | { command: 'agents/reveal'; path: string }
    | { command: 'agents/delete'; path: string }
    | { command: 'agents/openFolder'; scope: AgentScopeName };
