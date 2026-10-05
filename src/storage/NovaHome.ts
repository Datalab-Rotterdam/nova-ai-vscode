import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SLUG_MAX_LENGTH = 40;

export interface ProjectInfo {
    /** Original workspace path (or URI for non-file workspaces). */
    path: string;
    name: string;
    createdAt: string;
    lastOpenedAt: string;
}

/**
 * Nova's folder in the user's home directory (`~/.nova-ai`):
 *
 * ```
 * ~/.nova-ai/
 *   MEMORY.md  memory/           global memory index and notes
 *   projects/<slug>-<hash8>/     one folder per workspace
 *     project.json  MEMORY.md  memory/  sessions/  scratch/
 * ```
 *
 * The layout is shared with nova-ai-cli; docs/NOVA_HOME.md is the contract.
 */
export class NovaHome {
    public constructor(public readonly root: string) {
    }

    /** `nova.home` setting, then `NOVA_AI_HOME`, then `~/.nova-ai`. */
    public static resolve(): NovaHome {
        const configured = vscode.workspace.getConfiguration('nova').get<string>('home', '').trim();
        const fromEnv = process.env.NOVA_AI_HOME?.trim();
        const root = configured || fromEnv || path.join(os.homedir(), '.nova-ai');
        return new NovaHome(expandHome(root));
    }

    public get globalMemory(): string {
        return path.join(this.root, 'MEMORY.md');
    }

    /** Renames the global memory from its earlier name (`NOVA.md`) once. */
    public async migrateGlobalMemory(): Promise<void> {
        const legacy = path.join(this.root, 'NOVA.md');
        try {
            await fs.access(this.globalMemory);
        } catch {
            await fs.rename(legacy, this.globalMemory).catch(() => undefined);
        }
    }

    public get projectsDir(): string {
        return path.join(this.root, 'projects');
    }

    public project(key: string): ProjectPaths {
        const dir = path.join(this.projectsDir, key);
        return {
            key,
            dir,
            info: path.join(dir, 'project.json'),
            settings: path.join(dir, 'settings.json'),
            memory: path.join(dir, 'MEMORY.md'),
            sessions: path.join(dir, 'sessions'),
            scratch: path.join(dir, 'scratch')
        };
    }

    /** Creates the project folder and records where it came from. */
    public async ensureProject(paths: ProjectPaths, workspace: WorkspaceIdentity): Promise<void> {
        await ensureDir(paths.dir);
        const now = new Date().toISOString();
        let info: ProjectInfo = { path: workspace.path, name: workspace.name, createdAt: now, lastOpenedAt: now };
        try {
            const existing = JSON.parse(await fs.readFile(paths.info, 'utf8')) as ProjectInfo;
            info = { ...existing, path: workspace.path, name: workspace.name, lastOpenedAt: now };
        } catch {
            // first time
        }
        await writePrivateFile(paths.info, `${JSON.stringify(info, null, 2)}\n`);
    }

    /** Lists project folders with their recorded info. */
    public async listProjects(): Promise<Array<{ key: string; dir: string; info?: ProjectInfo }>> {
        let entries: string[];
        try {
            entries = await fs.readdir(this.projectsDir);
        } catch {
            return [];
        }
        return Promise.all(entries.map(async (key) => {
            const paths = this.project(key);
            try {
                return { key, dir: paths.dir, info: JSON.parse(await fs.readFile(paths.info, 'utf8')) as ProjectInfo };
            } catch {
                return { key, dir: paths.dir };
            }
        }));
    }
}

export interface ProjectPaths {
    key: string;
    dir: string;
    info: string;
    /** Private per-project settings (permission rules), shared with nova-ai-cli. */
    settings: string;
    memory: string;
    sessions: string;
    scratch: string;
}

export interface WorkspaceIdentity {
    /** Path (or URI) the key is derived from. */
    path: string;
    /** Human-readable name for the folder slug. */
    name: string;
    /** File-system path when the workspace is on disk. */
    fsPath?: string;
    scheme: string;
}

/** The current workspace: a saved multi-root workspace file, else the first folder. */
export function currentWorkspace(): WorkspaceIdentity | undefined {
    const file = vscode.workspace.workspaceFile;
    if (file && file.scheme !== 'untitled') {
        return {
            path: file.scheme === 'file' ? file.fsPath : file.toString(),
            name: path.basename(file.path).replace(/\.code-workspace$/i, ''),
            fsPath: file.scheme === 'file' ? file.fsPath : undefined,
            scheme: file.scheme
        };
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return undefined;
    }
    return {
        path: folder.uri.scheme === 'file' ? folder.uri.fsPath : folder.uri.toString(),
        name: folder.name,
        fsPath: folder.uri.scheme === 'file' ? folder.uri.fsPath : undefined,
        scheme: folder.uri.scheme
    };
}

/**
 * `<slug>-<hash8>`: readable, collision-free, fixed length and valid on every OS.
 * Unlike replacing path separators with dashes, `a/b-c` and `a-b/c` get different keys,
 * Windows drive letters are fine and long paths cannot exceed file-name limits.
 */
export async function workspaceKey(workspace: WorkspaceIdentity, platform: NodeJS.Platform = process.platform): Promise<string> {
    const slug = slugify(workspace.name) || 'workspace';
    const hash = createHash('sha256').update(await normalizeWorkspacePath(workspace, platform)).digest('hex').slice(0, 8);
    return `${slug}-${hash}`;
}

export async function normalizeWorkspacePath(workspace: WorkspaceIdentity, platform: NodeJS.Platform = process.platform): Promise<string> {
    if (!workspace.fsPath) {
        return workspace.path;
    }

    let resolved = workspace.fsPath;
    try {
        resolved = await fs.realpath(resolved);
    } catch {
        // Not on this disk (yet): use the path as given.
    }

    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    let normalized = pathApi.normalize(resolved);
    while (normalized.length > 1 && /[\\/]$/.test(normalized) && !/^[a-zA-Z]:\\$/.test(normalized)) {
        normalized = normalized.slice(0, -1);
    }
    // Default file systems on Windows and macOS are case-insensitive.
    return platform === 'win32' || platform === 'darwin' ? normalized.toLowerCase() : normalized;
}

export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, SLUG_MAX_LENGTH)
        .replace(/[-.]+$/g, '');
}

export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
}

/**
 * Writes a file readable only by the user, creating its directory. The content goes to a
 * temporary file first and is renamed into place, so readers (this extension, nova-ai-cli)
 * never see a half-written file.
 */
export async function writePrivateFile(file: string, content: string): Promise<void> {
    await ensureDir(path.dirname(file));
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await fs.writeFile(temp, content, { mode: FILE_MODE, flag: 'wx' });
        await fs.rename(temp, file);
    } catch (error) {
        await fs.rm(temp, { force: true });
        throw error;
    }
}

/** Deletes files in `dir` (recursively) not modified for `maxAgeDays`, and then empty folders. */
export async function pruneOlderThan(dir: string, maxAgeDays: number, now = Date.now()): Promise<number> {
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    const visit = async (current: string): Promise<boolean> => {
        let entries: import('node:fs').Dirent[];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return false;
        }
        let remaining = entries.length;
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (await visit(full)) {
                    await fs.rmdir(full).catch(() => undefined);
                    remaining--;
                }
            } else {
                const stat = await fs.lstat(full).catch(() => undefined);
                if (stat && stat.mtimeMs < cutoff) {
                    await fs.rm(full, { force: true });
                    removed++;
                    remaining--;
                }
            }
        }
        return remaining === 0;
    };

    await visit(dir);
    return removed;
}

function expandHome(value: string): string {
    return value === '~' || value.startsWith('~/') || value.startsWith('~\\')
        ? path.join(os.homedir(), value.slice(1))
        : path.resolve(value);
}
