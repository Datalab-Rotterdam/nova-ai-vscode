import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { labelOf, SettingsController } from '../src/settings/SettingsController';
import type { SettingsPageData } from '../src/settings/protocol';

const sections = [
    { id: 'nova.editor', title: 'Editor', order: 7, properties: {
        'nova.inline.model': { type: 'string', default: '', markdownDescription: 'Model for edits. [Choose from your models](command:nova.chooseModel?%5B%22inline.model%22%5D)', order: 1 },
        'nova.inline.debounceMs': { type: 'number', default: 300, minimum: 100, maximum: 2000, order: 2 }
    } },
    { id: 'nova.chat.agent', title: 'Chat › Agent', order: 2, properties: {
        'nova.agent.approvalMode': { type: 'string', enum: ['ask', 'autoAll'], enumDescriptions: ['Ask first', 'Never ask'], default: 'ask' },
        'nova.agent.subagents.allowedModels': { type: 'array', items: { type: 'string' }, default: [] },
        'nova.home': { type: 'string', default: '', scope: 'machine' }
    } }
];

/** A configuration with user and workspace values, recording updates. */
function configuration(user: Record<string, unknown>, workspace: Record<string, unknown>) {
    const update = vi.fn(async () => undefined);
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: <T>(_key: string, fallback: T) => fallback,
        inspect: (key: string) => ({ key, defaultValue: undefined, globalValue: user[key], workspaceValue: workspace[key] }),
        update
    } as never);
    return update;
}

async function page(user: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
    const update = configuration(user, workspace);
    const posts: SettingsPageData[] = [];
    const models = async (kind: 'chat' | 'embedding') => kind === 'chat' ? [{ id: 'fast-1', name: 'Fast' }] : [];
    const controller = new SettingsController(() => sections as never, models, (message) => void posts.push(message.data));
    return { controller, update, posts, latest: () => posts.at(-1)! };
}

afterEach(() => {
    vi.restoreAllMocks();
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
});

describe('Nova Settings page', () => {
    it('builds sections in order from the contributed settings, with a control per type and models as choices', async () => {
        const { controller, latest } = await page({ 'nova.inline.debounceMs': 500 });
        await controller.handle({ command: 'settings/ready' });
        const data = latest();
        expect(data.sections.map((section) => section.title)).toEqual(['Chat › Agent', 'Editor']);
        const rows = Object.fromEntries(data.sections.flatMap((section) => section.rows).map((row) => [row.key, row]));
        expect(rows['nova.inline.model']).toMatchObject({ control: 'model', label: 'Model', description: 'Model for edits.', options: [{ value: '', label: 'Off' }, { value: 'fast-1', label: 'Fast', description: 'fast-1' }] });
        expect(rows['nova.inline.debounceMs']).toMatchObject({ control: 'number', value: 500, setHere: true, min: 100, max: 2000 });
        expect(rows['nova.agent.approvalMode']).toMatchObject({ control: 'enum', options: [{ value: 'ask', description: 'Ask first' }, { value: 'autoAll', description: 'Never ask' }] });
        expect(rows['nova.agent.subagents.allowedModels']).toMatchObject({ control: 'multi', options: [{ value: 'fast-1' }] });
        expect(rows['nova.home']).toMatchObject({ userOnly: true });
    });

    it('saves in User or Workspace, shows what the workspace overrides, and resets', async () => {
        (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ name: 'repo', uri: vscode.Uri.file('/repo'), index: 0 }];
        const { controller, update, latest } = await page({ 'nova.inline.debounceMs': 500 }, { 'nova.inline.debounceMs': 800 });
        await controller.handle({ command: 'settings/ready' });
        const row = () => latest().sections.flatMap((section) => section.rows).find((candidate) => candidate.key === 'nova.inline.debounceMs')!;
        expect(row()).toMatchObject({ value: 500, overridden: true });

        await controller.handle({ command: 'settings/set', key: 'nova.inline.debounceMs', value: 400 });
        expect(update).toHaveBeenLastCalledWith('nova.inline.debounceMs', 400, vscode.ConfigurationTarget.Global);

        await controller.handle({ command: 'settings/scope', scope: 'workspace' });
        expect(row()).toMatchObject({ value: 800, setHere: true });
        expect(row().overridden).toBeUndefined();
        await controller.handle({ command: 'settings/reset', key: 'nova.inline.debounceMs' });
        expect(update).toHaveBeenLastCalledWith('nova.inline.debounceMs', undefined, vscode.ConfigurationTarget.Workspace);

        await controller.handle({ command: 'settings/set', key: 'other.extension.setting', value: 1 });
        expect(update).toHaveBeenCalledTimes(2);
    });

    it('labels settings from their key', () => {
        expect(labelOf('nova.agent.subagents.maxParallel')).toBe('Max Parallel');
        expect(labelOf('nova.agent.includeMcpTools')).toBe('Include MCP Tools');
        expect(labelOf('nova.webSearch.searxng')).toBe('SearXNG');
    });
});
