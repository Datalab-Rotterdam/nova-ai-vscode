import type { ApprovalMode } from './protocol';

/** Pure helpers behind the composer's agent and permission menus (kept apart for tests). */

/** The agent after `currentId` in the menu's order, wrapping around (shift+tab). */
export function nextAgentId(agents: ReadonlyArray<{ id: string }>, currentId: string | undefined): string | undefined {
    if (!agents.length) {
        return undefined;
    }
    const index = agents.findIndex((agent) => agent.id === currentId);
    return agents[(index + 1) % agents.length].id;
}

export interface PermissionOption {
    mode: ApprovalMode;
    label: string;
    description: string;
    icon: string;
    experimental?: boolean;
}

/** Permission modes as the menu shows them; stored in `nova.agent.approvalMode`. */
export const PERMISSION_OPTIONS: readonly PermissionOption[] = [
    { mode: 'ask', label: 'Manual permissions', description: 'Asks before every edit and command', icon: 'key' },
    { mode: 'autoReadOnly', label: 'Assisted permissions', description: 'Runs read-only tools and allowed rules, asks for the rest', icon: 'sparkle', experimental: true },
    { mode: 'autoAll', label: 'Allow all', description: 'Runs tool calls without asking', icon: 'warning' }
];

export function permissionOption(mode: ApprovalMode): PermissionOption {
    return PERMISSION_OPTIONS.find((option) => option.mode === mode) ?? PERMISSION_OPTIONS[1];
}
