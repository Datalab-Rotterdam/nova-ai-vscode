/** Messages between the Hooks page (webview) and the extension. */

export type HookScopeName = 'workspace' | 'user';

export interface HookRow {
    event: string;
    /** Tool events only; undefined: every tool. */
    matcher?: string;
    command: string;
    timeout?: number;
    scope: HookScopeName;
    /** Which settings file: the user's, the private project file, the workspace's shared or local one. */
    kind: 'user' | 'project' | 'shared' | 'local';
    file: string;
    /** The file shown to the user, e.g. "~/.nova-ai/settings.json". */
    location: string;
    group: number;
    index: number;
}

export interface HooksPageData {
    hooks: HookRow[];
    hasProject: boolean;
    /** Workspace hooks only run in a trusted workspace. */
    trusted: boolean;
    /** Where new hooks go, per scope, for display. */
    files: { user: string; workspace?: string };
}

export type HookRef = { file: string; event: string; group: number; index: number; command: string };

export type HooksCommand =
    | { command: 'hooks/ready' }
    | { command: 'hooks/create'; scope: HookScopeName }
    | ({ command: 'hooks/open' } & HookRef)
    | ({ command: 'hooks/delete' } & HookRef)
    | { command: 'hooks/openFile'; scope: HookScopeName };
