/**
 * Messages of the Nova Settings page, shared with its webview, so it must not import `vscode`.
 */

export type SettingsScope = 'user' | 'workspace';

/** How a setting is edited: a model setting gets a list of the models, not a text field. */
export type SettingControl = 'boolean' | 'number' | 'text' | 'enum' | 'model' | 'multi' | 'json';

export interface SettingOption {
    value: string;
    label: string;
    description?: string;
}

export interface SettingRow {
    key: string;
    label: string;
    /** Markdown, without the links that only work in VS Code's own settings. */
    description: string;
    control: SettingControl;
    options?: SettingOption[];
    min?: number;
    max?: number;
    integer?: boolean;
    /** The value that applies in the scope shown. */
    value: unknown;
    defaultValue: unknown;
    /** Set in the scope shown (so it can be reset there). */
    setHere: boolean;
    /** Shown in User: the workspace sets its own value, which wins. */
    overridden?: boolean;
    /** Only a user setting (for example a folder on this machine). */
    userOnly?: boolean;
}

export interface SettingsSection {
    id: string;
    title: string;
    rows: SettingRow[];
}

export interface SettingsPageData {
    scope: SettingsScope;
    hasWorkspace: boolean;
    sections: SettingsSection[];
}

export type SettingsCommand =
    | { command: 'settings/ready' }
    | { command: 'settings/scope'; scope: SettingsScope }
    | { command: 'settings/set'; key: string; value: unknown }
    | { command: 'settings/reset'; key: string }
    | { command: 'settings/openJson' }
    | { command: 'settings/openVsCode' };
