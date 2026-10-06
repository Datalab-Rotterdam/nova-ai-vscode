import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writePrivateFile } from '../storage/NovaHome';

/*
 * Skills as described in docs/NOVA_HOME.md ("Skills"), shared with nova-ai-cli: a folder
 * with a SKILL.md, found in the shared .agents/.claude/.codex folders and in Nova's own,
 * globally and per project; switched off by name in the settings files.
 */

export type SkillScope = 'global' | 'project';
export type SkillFolder = 'nova' | '.agents' | '.claude' | '.codex';

export interface Skill {
    name: string;
    description: string;
    /** The SKILL.md file. */
    path: string;
    /** The skill's folder. */
    root: string;
    scope: SkillScope;
    folder: SkillFolder;
    /** Set for bundled skills: shipped and updated by a Nova app, read-only, can only be switched off. */
    bundled?: BundledSkill;
}

/** Contents of a bundled skill's `.nova-bundled.json` (docs/NOVA_HOME.md, "Bundled skills"). */
export interface BundledSkill {
    /** The app that installs and updates it, e.g. "Nova AI Browser". */
    bundledBy: string;
    version?: string;
}

export const BUNDLE_FILE = '.nova-bundled.json';

/** The bundle marker of a skill folder, if it is a bundled skill. */
export function readBundle(root: string): BundledSkill | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path.join(root, BUNDLE_FILE), 'utf8'));
        if (isRecord(parsed) && typeof parsed.bundledBy === 'string' && parsed.bundledBy.trim()) {
            return { bundledBy: parsed.bundledBy, ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}) };
        }
    } catch {
        // No marker: a normal skill.
    }
    return undefined;
}

/**
 * The bundled skill a file belongs to, if any: walks up from the file to the nearest folder
 * with a SKILL.md. Nova's file tools refuse to change such files.
 */
export function bundledSkillOf(file: string): { root: string; bundle: BundledSkill } | undefined {
    let dir = path.dirname(path.resolve(file));
    for (let depth = 0; depth < 6; depth++) {
        if (existsSync(path.join(dir, 'SKILL.md'))) {
            const bundle = readBundle(dir);
            return bundle ? { root: dir, bundle } : undefined;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

export interface SkillView extends Skill {
    /** Used in chats here: found, not replaced by another skill of that name, and not switched off. */
    enabled: boolean;
    offGlobally: boolean;
    offInProject: boolean;
    /** SKILL.md of the skill with the same name that takes precedence. */
    replacedBy?: string;
}

export interface SkillPaths {
    /** The user's home folder (for ~/.agents, ~/.claude, ~/.codex). */
    home: string;
    /** $NOVA_AI_HOME or ~/.nova-ai. */
    novaHome: string;
    /** projects/<key>/settings.json of this workspace, if there is one. */
    projectSettings?: string;
    /** Workspace folders (project skills), in order. */
    workspaceRoots: string[];
}

export const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHARED_FOLDERS = ['.agents', '.claude', '.codex'] as const;
const MAX_VISITED_DIRECTORIES = 500;

/** Folders that hold skills, lowest priority first. */
export function skillRoots(paths: SkillPaths): Array<{ path: string; scope: SkillScope; folder: SkillFolder }> {
    return [
        ...SHARED_FOLDERS.map((folder) => ({ path: path.join(paths.home, folder, 'skills'), scope: 'global' as const, folder })),
        { path: path.join(paths.novaHome, 'skills'), scope: 'global' as const, folder: 'nova' as const },
        ...paths.workspaceRoots.flatMap((root) => [
            ...SHARED_FOLDERS.map((folder) => ({ path: path.join(root, folder, 'skills'), scope: 'project' as const, folder })),
            { path: path.join(root, '.nova-ai', 'skills'), scope: 'project' as const, folder: 'nova' as const }
        ])
    ];
}

/** Where Nova creates (and moves) skills of a scope. */
export function novaSkillsFolder(paths: SkillPaths, scope: SkillScope, workspaceRoot = paths.workspaceRoots[0]): string | undefined {
    if (scope === 'global') {
        return path.join(paths.novaHome, 'skills');
    }
    return workspaceRoot ? path.join(workspaceRoot, '.nova-ai', 'skills') : undefined;
}

/** Every skill found, including ones replaced by a later skill of the same name, in priority order. */
export function findAllSkills(paths: SkillPaths): Skill[] {
    const skills: Skill[] = [];
    for (const root of skillRoots(paths)) {
        for (const file of findSkillFiles(root.path)) {
            const metadata = readSkillMetadata(file);
            if (metadata) {
                const bundle = readBundle(path.dirname(file));
                skills.push({ ...metadata, path: file, root: path.dirname(file), scope: root.scope, folder: root.folder, ...(bundle ? { bundled: bundle } : {}) });
            }
        }
    }
    return skills;
}

/** One skill per name: the one in the highest-priority folder. Sorted by name. */
export function effectiveSkills(all: readonly Skill[]): Skill[] {
    const byName = new Map<string, Skill>();
    for (const skill of all) {
        byName.set(skill.name, skill);
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function disabledSkills(paths: SkillPaths): { global: Set<string>; project: Set<string> } {
    return {
        global: readDisabled(path.join(paths.novaHome, 'settings.json')),
        project: paths.projectSettings ? readDisabled(paths.projectSettings) : new Set()
    };
}

/** The skills chats may use: one per name, not switched off globally or in this project. */
export function enabledSkills(paths: SkillPaths): Skill[] {
    const off = disabledSkills(paths);
    return effectiveSkills(findAllSkills(paths)).filter((skill) => !off.global.has(skill.name) && !off.project.has(skill.name));
}

/** What the Skills page shows. */
export function skillViews(paths: SkillPaths): SkillView[] {
    const all = findAllSkills(paths);
    const winners = new Map(effectiveSkills(all).map((skill) => [skill.name, skill]));
    const off = disabledSkills(paths);
    return all
        .map((skill) => {
            const winner = winners.get(skill.name)!;
            const offGlobally = off.global.has(skill.name);
            const offInProject = off.project.has(skill.name);
            return {
                ...skill,
                offGlobally,
                offInProject,
                enabled: winner.path === skill.path && !offGlobally && !offInProject,
                ...(winner.path !== skill.path ? { replacedBy: winner.path } : {})
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
}

/** Switches a skill on or off by name: everywhere (global) or in this project; other settings are kept. */
export async function setSkillEnabled(paths: SkillPaths, scope: SkillScope, name: string, enabled: boolean): Promise<void> {
    const file = scope === 'global' ? path.join(paths.novaHome, 'settings.json') : paths.projectSettings;
    if (!file) {
        throw new Error('Open a folder to change project settings.');
    }
    const settings = await readSettings(file);
    const skills = isRecord(settings.skills) ? settings.skills : {};
    const disabled = (Array.isArray(skills.disabled) ? skills.disabled : [])
        .filter((entry): entry is string => typeof entry === 'string' && entry !== name);
    if (!enabled) {
        disabled.push(name);
    }
    await writePrivateFile(file, `${JSON.stringify({ ...settings, skills: { ...skills, disabled } }, null, 2)}\n`);
}

/** Creates `<Nova skills folder>/<name>/SKILL.md` from a template; returns its path. */
export async function createSkill(paths: SkillPaths, scope: SkillScope, name: string, description: string, workspaceRoot?: string): Promise<string> {
    if (!SKILL_NAME_PATTERN.test(name)) {
        throw new Error('A skill name uses lower-case letters, digits and dashes (at most 64).');
    }
    const folder = novaSkillsFolder(paths, scope, workspaceRoot);
    if (!folder) {
        throw new Error('Open a folder to create project skills.');
    }
    const root = path.join(folder, name);
    const file = path.join(root, 'SKILL.md');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file, skillTemplate(name, description), { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        throw error.code === 'EEXIST' ? new Error(`A skill named "${name}" already exists there.`) : error;
    });
    return file;
}

/** Why a bundled skill cannot be changed, for messages to the user and the model. */
export function bundledMessage(skill: Pick<Skill, 'name' | 'bundled'>): string {
    return `"${skill.name}" is bundled with ${skill.bundled?.bundledBy ?? 'a Nova app'}, which keeps it up to date; it cannot be edited, moved or deleted, only switched off.`;
}

export function skillTemplate(name: string, description: string): string {
    const summary = description.trim() || 'What this skill does and when to use it.';
    return [
        '---',
        `name: ${name}`,
        `description: ${JSON.stringify(summary)}`,
        '---',
        '',
        `# ${name}`,
        '',
        'Steps Nova follows when this skill is used. Keep it focused; put long reference',
        'material in separate files next to this one and mention them here, so Nova only',
        'reads them when needed.',
        '',
        '1. …',
        ''
    ].join('\n');
}

/** Moves a skill's folder into Nova's folder of the other scope; returns the new SKILL.md. */
export async function moveSkill(paths: SkillPaths, skill: Skill, to: SkillScope, workspaceRoot?: string): Promise<string> {
    if (skill.bundled) {
        throw new Error(bundledMessage(skill));
    }
    const folder = novaSkillsFolder(paths, to, workspaceRoot);
    if (!folder) {
        throw new Error('Open a folder to move skills into the project.');
    }
    const target = path.join(folder, path.basename(skill.root));
    if (path.resolve(target) === path.resolve(skill.root)) {
        return skill.path;
    }
    if (await exists(target)) {
        throw new Error(`${target} already exists.`);
    }
    await fs.mkdir(folder, { recursive: true });
    await fs.cp(skill.root, target, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(skill.root, { recursive: true, force: true });
    return path.join(target, path.basename(skill.path));
}

function findSkillFiles(root: string): string[] {
    const files: string[] = [];
    const pending = [root];
    let visited = 0;
    while (pending.length && visited < MAX_VISITED_DIRECTORIES) {
        const directory = pending.pop()!;
        visited++;
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) {
                continue;
            }
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                pending.push(full);
            } else if (entry.isFile() && entry.name === 'SKILL.md') {
                files.push(full);
            }
        }
    }
    return files.sort();
}

function readSkillMetadata(file: string): { name: string; description: string } | undefined {
    let content: string;
    try {
        content = readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
    return {
        name: frontmatterValue(frontmatter, 'name') || path.basename(path.dirname(file)),
        description: frontmatterValue(frontmatter, 'description') || 'No description provided.'
    };
}

function frontmatterValue(frontmatter: string, key: string): string {
    const raw = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim() ?? '';
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1).replace(/\\"/g, '"');
    }
    return raw;
}

function readDisabled(file: string): Set<string> {
    try {
        const settings: unknown = JSON.parse(readFileSync(file, 'utf8'));
        const skills = isRecord(settings) && isRecord(settings.skills) ? settings.skills : undefined;
        return new Set(Array.isArray(skills?.disabled) ? skills.disabled.filter((name): name is string => typeof name === 'string') : []);
    } catch {
        return new Set();
    }
}

async function readSettings(file: string): Promise<Record<string, unknown>> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
        return isRecord(parsed) ? parsed : {};
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw new Error(`${file} is not valid JSON; fix it before changing skills.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}
