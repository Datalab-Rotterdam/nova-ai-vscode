import * as vscode from 'vscode';

export interface ModelChoice {
    id: string;
    name: string;
}

interface ModelSetting {
    title: string;
    kind: 'chat' | 'embedding';
    /** The choice that stores this value instead of a model id (off, automatic, same as the chat). */
    none?: { label: string; value: string };
    /** A list of model ids (several can be picked). */
    many?: boolean;
}

/** Nova's settings that hold a model id; `nova.chooseModel` lets the user pick from the models instead of typing an id. */
export const MODEL_SETTINGS: Record<string, ModelSetting> = {
    'inline.model': { title: 'Model for inline edits and Tab completions', kind: 'chat', none: { label: 'Off', value: '' } },
    'index.model': { title: 'Embedding model for semantic search', kind: 'embedding', none: { label: 'Automatic: the first embedding model', value: '' } },
    'agent.subagents.model': { title: 'Model for sub-agents', kind: 'chat', none: { label: 'Same as the chat', value: 'inherit' } },
    'agent.subagents.allowedModels': { title: 'Models Nova may choose per sub-agent', kind: 'chat', many: true }
};

/**
 * Nova AI: Choose Models. With a setting key (from a link in the setting's description) it asks
 * for that setting's model right away; without one it first asks which setting to change.
 * Returns the stored value, or undefined when the user cancelled.
 */
export async function chooseModelSetting(models: (kind: ModelSetting['kind']) => Promise<ModelChoice[]>, key?: string): Promise<string | string[] | undefined> {
    const config = () => vscode.workspace.getConfiguration('nova');
    if (!key) {
        const picked = await vscode.window.showQuickPick(Object.entries(MODEL_SETTINGS).map(([settingKey, setting]) => ({
            label: setting.title,
            description: describe(config().get(settingKey), setting),
            key: settingKey
        })), { title: 'Nova AI: Choose Models' });
        key = picked?.key;
    }
    const setting = key ? MODEL_SETTINGS[key] : undefined;
    if (!key || !setting) {
        return undefined;
    }
    const available = await models(setting.kind);
    if (!available.length) {
        void vscode.window.showWarningMessage(setting.kind === 'embedding' ? 'Your Nova gateway lists no embedding models.' : 'No Nova models are available. Connect Nova AI first.');
        return undefined;
    }
    const current = config().get<unknown>(key);
    const items = available.map((model) => ({ label: model.name, description: model.id === model.name ? undefined : model.id, value: model.id }));

    let value: string | string[];
    if (setting.many) {
        const selected = new Set(Array.isArray(current) ? current : []);
        const picked = await vscode.window.showQuickPick(items.map((item) => ({ ...item, picked: selected.has(item.value) })), { title: setting.title, canPickMany: true });
        if (!picked) {
            return undefined;
        }
        value = picked.map((item) => item.value);
    } else {
        const choices = [...(setting.none ? [{ label: setting.none.label, value: setting.none.value }] : []), ...items]
            .map((item) => ({ ...item, ...(item.value === current ? { detail: '$(check) current' } : {}) }));
        const picked = await vscode.window.showQuickPick(choices, { title: setting.title, matchOnDescription: true });
        if (!picked) {
            return undefined;
        }
        value = picked.value;
    }
    // Where the user set it before (workspace or user settings), so the change takes effect.
    const inspected = config().inspect(key);
    const target = inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config().update(key, value, target);
    return value;
}

function describe(value: unknown, setting: ModelSetting): string {
    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : 'none';
    }
    return value === undefined || value === setting.none?.value ? setting.none?.label ?? '' : String(value);
}
