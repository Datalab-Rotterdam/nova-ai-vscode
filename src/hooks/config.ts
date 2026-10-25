import * as path from 'node:path';

/**
 * Reading and changing the `hooks` key of one settings file (format: see HookService),
 * for the Hooks page. Entries Nova doesn't run (another `type`, no command) are left alone.
 */

export interface HookEntry {
    event: string;
    /** Tool events only; undefined or empty: every tool. */
    matcher?: string;
    command: string;
    timeout?: number;
    /** Position in the file: `hooks[event][group].hooks[index]`. */
    group: number;
    index: number;
}

type Settings = Record<string, unknown>;

export function listHooks(settings: Settings | undefined): HookEntry[] {
    const hooks = settings?.hooks;
    if (!hooks || typeof hooks !== 'object') {
        return [];
    }
    return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((entry: unknown, group) => {
        const { matcher, hooks: list } = (entry ?? {}) as { matcher?: unknown; hooks?: unknown };
        return (Array.isArray(list) ? list : []).flatMap((hook: unknown, index): HookEntry[] => {
            const { type, command, timeout } = (hook ?? {}) as { type?: unknown; command?: unknown; timeout?: unknown };
            return (type === undefined || type === 'command') && typeof command === 'string'
                ? [{
                    event,
                    ...(typeof matcher === 'string' && matcher ? { matcher } : {}),
                    command,
                    ...(typeof timeout === 'number' ? { timeout } : {}),
                    group,
                    index
                }]
                : [];
        });
    }));
}

/** Adds a command hook, to the event's group with the same matcher when there is one. */
export function addHook(settings: Settings, event: string, matcher: string | undefined, command: string): Settings {
    const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : (settings.hooks = {})) as Record<string, unknown>;
    const groups = (Array.isArray(hooks[event]) ? hooks[event] : (hooks[event] = [])) as Array<Record<string, unknown>>;
    const same = groups.find((group) => group && typeof group === 'object' && (group.matcher || undefined) === (matcher || undefined) && Array.isArray(group.hooks));
    const hook = { type: 'command', command };
    if (same) {
        (same.hooks as unknown[]).push(hook);
    } else {
        groups.push({ ...(matcher ? { matcher } : {}), hooks: [hook] });
    }
    return settings;
}

/** Removes one hook; a group without hooks and an event without groups go too. */
export function removeHook(settings: Settings, event: string, group: number, index: number): Settings {
    const hooks = settings.hooks as Record<string, unknown> | undefined;
    const groups = hooks?.[event] as Array<{ hooks?: unknown[] }> | undefined;
    const list = groups?.[group]?.hooks;
    if (!hooks || !groups || !Array.isArray(list) || index >= list.length) {
        throw new Error('That hook is no longer in the settings file.');
    }
    list.splice(index, 1);
    if (!list.length) {
        groups.splice(group, 1);
    }
    if (!groups.length) {
        delete hooks[event];
    }
    if (!Object.keys(hooks).length) {
        delete settings.hooks;
    }
    return settings;
}

/**
 * The command that runs a script file: with its interpreter by extension (so a shell script
 * needs no execute bit), relative to the workspace root when it is in there.
 */
export function scriptCommand(file: string, root?: string, platform = process.platform): string {
    const relative = root ? path.relative(root, file) : '';
    const inRoot = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    let shown = inRoot ? relative.split(path.sep).join('/') : file;
    shown = /[\s"'$`]/.test(shown) ? JSON.stringify(shown) : shown;
    switch (path.extname(file).toLowerCase()) {
        case '.js':
        case '.mjs':
        case '.cjs':
            return `node ${shown}`;
        case '.py':
            return `${platform === 'win32' ? 'python' : 'python3'} ${shown}`;
        case '.sh':
            return `bash ${shown}`;
        case '.ps1':
            return `pwsh -File ${shown}`;
        default:
            return inRoot && platform !== 'win32' && !shown.startsWith('"') ? `./${shown}` : shown;
    }
}
