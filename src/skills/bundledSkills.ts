import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BUNDLE_FILE } from './SkillService';

/*
 * Skills this extension ships (resources/skills/<name>/): installed into ~/.nova-ai/skills as
 * bundled skills (docs/NOVA_HOME.md, "Bundled skills"): read-only, marked with .nova-bundled.json,
 * and reinstalled when the version or the content no longer matches. A skill folder without our
 * marker is the user's own and is never touched.
 */

export const BUNDLED_BY = 'Nova AI for VS Code';

/** Skills an earlier version shipped under another name; removed from the skills folder when they are ours. */
const RETIRED_SKILLS = ['nova-documents'];

/** Every file below a folder, relative with `/` separators, sorted; the marker file and Python caches are left out. */
async function listFiles(root: string, folder = ''): Promise<string[]> {
    const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of entries) {
        const relative = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            // Python writes __pycache__ next to scripts it imports: not part of the skill.
            if (entry.name !== '__pycache__') {
                files.push(...await listFiles(root, relative));
            }
        } else if (entry.isFile() && entry.name !== BUNDLE_FILE) {
            files.push(relative);
        }
    }
    return files.sort();
}

/** SHA-256 over the names and contents of a skill's files. */
export async function hashSkill(root: string): Promise<string> {
    const hash = createHash('sha256');
    for (const file of await listFiles(root)) {
        hash.update(`${file}\0`);
        hash.update(await fs.readFile(path.join(root, file)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

async function readMarker(folder: string): Promise<{ bundledBy?: unknown } | undefined> {
    try {
        return JSON.parse(await fs.readFile(path.join(folder, BUNDLE_FILE), 'utf8')) as { bundledBy?: unknown };
    } catch {
        return undefined;
    }
}

async function copySkill(from: string, to: string): Promise<void> {
    await fs.rm(to, { recursive: true, force: true });
    for (const file of await listFiles(from)) {
        const target = path.join(to, ...file.split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(from, ...file.split('/')), target);
        await fs.chmod(target, file.endsWith('.py') ? 0o555 : 0o444).catch(() => undefined);
    }
}

/**
 * Installs or updates the skills in `sourceDir` under `<novaHome>/skills`. Returns the names it
 * (re)installed; skills that are current, and folders that are not ours, are left alone.
 */
export async function installBundledSkills(sourceDir: string, novaHome: string, version: string): Promise<string[]> {
    const installed: string[] = [];
    for (const name of RETIRED_SKILLS) {
        const old = path.join(novaHome, 'skills', name);
        if ((await readMarker(old))?.bundledBy === BUNDLED_BY) {
            await fs.rm(old, { recursive: true, force: true });
        }
    }
    const sources = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    for (const source of sources) {
        const from = path.join(sourceDir, source.name);
        if (!source.isDirectory() || !(await fs.stat(path.join(from, 'SKILL.md')).catch(() => undefined))) {
            continue;
        }
        const to = path.join(novaHome, 'skills', source.name);
        const hash = await hashSkill(from);
        const exists = await fs.stat(to).catch(() => undefined);
        if (exists) {
            const marker = await readMarker(to);
            if (marker?.bundledBy !== BUNDLED_BY) {
                continue;
            }
            // Current: the content matches, so nothing was edited and nothing changed.
            if (await hashSkill(to) === hash) {
                continue;
            }
        }
        await copySkill(from, to);
        await fs.writeFile(path.join(to, BUNDLE_FILE), `${JSON.stringify({ bundledBy: BUNDLED_BY, version, hash }, null, 2)}\n`, { mode: 0o444 });
        installed.push(source.name);
    }
    return installed;
}
