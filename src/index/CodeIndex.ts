import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureDir, writePrivateFile } from '../storage/NovaHome';

const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/coverage/**,**/*.min.js,**/*.map,**/*.lock,**/package-lock.json}';
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 200_000;
const CHUNK_LINES = 60;
const CHUNK_OVERLAP = 10;
const MAX_CHUNK_CHARS = 4_000;
const BATCH_SIZE = 64;
/** How long the embedding model found in the model list is trusted before asking again. */
const MODEL_TTL_MS = 10 * 60_000;
/** What the watcher skips: the same folders and files as `EXCLUDE`. */
const EXCLUDED = /[\\/](?:node_modules|\.git|dist|out|build|\.next|coverage)[\\/]|\.min\.js$|\.map$|\.lock$|[\\/]package-lock\.json$/;
/** From this many files to embed, an update shows its progress. */
const PROGRESS_FROM_FILES = 50;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|jar|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|wasm|bin|class|pyc|sqlite|db)$/i;

/** The part of the Nova client the index uses. */
export interface EmbeddingClient {
    models: { list(options?: { limit?: number }): Promise<{ data: Array<{ id: string; name?: string | null; capabilities?: string[] }> }> };
    embeddings: { create(request: { model: string; input: string[] }): Promise<{ data: Array<{ index: number; embedding: number[] }> }> };
}

export interface IndexHit {
    path: string;
    /** 1-based, inclusive. */
    start: number;
    end: number;
    score: number;
}

interface Chunk {
    /** Absolute path. */
    file: string;
    start: number;
    end: number;
}

interface StoredIndex {
    model: string;
    dims: number;
    /** Modification time per absolute path, to re-embed only what changed. */
    mtimes: Record<string, number>;
    chunks: Chunk[];
}

/**
 * Semantic code search over the workspace: files are cut into overlapping chunks of lines,
 * embedded with the gateway's embedding model, and kept in the project folder
 * (`projects/<key>/index/`: `chunks.json` and `vectors.f32`, normalized float32 vectors).
 * Built on the first search. The first update in a window checks every file's modification
 * time (to catch changes made while it was closed); after that a file watcher marks what
 * changed, and a search embeds only those files.
 * Without an embedding model in the model list (or with `nova.index.enabled` off) there is
 * no index and no tool.
 */
export class CodeIndex {
    private stored?: StoredIndex;
    private vectors = new Float32Array(0);
    private model?: { models: Array<{ id: string; name: string }>; at: number };
    private updating?: Promise<void>;
    /** Whether this window has compared every file with the stored index yet. */
    private scanned = false;
    /** Files created, changed or deleted since the last update (absolute paths). */
    private dirty = new Set<string>();

    public constructor(private readonly deps: {
        client(): Promise<EmbeddingClient | undefined>;
        /** The index folder of this workspace, or undefined without one. */
        dir(): string | undefined;
        log?(message: string, error?: unknown): void;
    }) {
    }

    /** Marks files as changed when they are created, changed or deleted in the workspace. */
    public watch(): vscode.Disposable {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        const mark = (uri: vscode.Uri) => {
            if (uri.scheme === 'file' && !EXCLUDED.test(uri.fsPath) && !BINARY.test(uri.fsPath)) {
                this.dirty.add(uri.fsPath);
            }
        };
        return vscode.Disposable.from(watcher, watcher.onDidCreate(mark), watcher.onDidChange(mark), watcher.onDidDelete(mark));
    }

    /** Whether semantic search can be offered: on, a folder is open, and an embedding model exists. */
    public async available(): Promise<boolean> {
        return vscode.workspace.getConfiguration('nova').get<boolean>('index.enabled', true) && !!this.deps.dir() && !!await this.embeddingModel();
    }

    /** `nova.index.model`, else the first model that lists the `embedding` capability. */
    public async embeddingModel(): Promise<string | undefined> {
        const configured = vscode.workspace.getConfiguration('nova').get<string>('index.model', '').trim();
        if (configured) {
            return configured;
        }
        return (await this.embeddingModels())[0]?.id;
    }

    /** The gateway's models with the `embedding` capability (the chat model list leaves them out). */
    public async embeddingModels(): Promise<Array<{ id: string; name: string }>> {
        if (!this.model || Date.now() - this.model.at > MODEL_TTL_MS) {
            const client = await this.deps.client();
            const models = client ? await client.models.list({ limit: 500 }).catch(() => undefined) : undefined;
            this.model = {
                models: (models?.data ?? []).filter((model) => model.capabilities?.includes('embedding')).map((model) => ({ id: model.id, name: model.name || model.id })),
                at: Date.now()
            };
        }
        return this.model.models;
    }

    /** The chunks most like the query, best first. */
    public async search(query: string, k: number, token?: vscode.CancellationToken): Promise<IndexHit[]> {
        await this.update(token);
        const client = await this.deps.client();
        const stored = this.stored;
        if (!client || !stored?.chunks.length) {
            return [];
        }
        const [vector] = await embed(client, stored.model, [query]);
        const scores = stored.chunks.map((chunk, index) => ({ chunk, score: dot(this.vectors, index * stored.dims, vector) }));
        scores.sort((left, right) => right.score - left.score);
        return scores.slice(0, k).map(({ chunk, score }) => ({ path: chunk.file, start: chunk.start, end: chunk.end, score }));
    }

    /** Brings the index up to date with the workspace; one update runs at a time. */
    public update(token?: vscode.CancellationToken): Promise<void> {
        this.updating ??= this.updateOnce(token).finally(() => this.updating = undefined);
        return this.updating;
    }

    private async updateOnce(token?: vscode.CancellationToken): Promise<void> {
        const dir = this.deps.dir();
        const model = await this.embeddingModel();
        const client = await this.deps.client();
        if (!dir || !model || !client) {
            throw new Error('No embedding model is available.');
        }
        await this.load(dir, model);
        const previous = this.stored ?? { model, dims: 0, mtimes: {}, chunks: [] };
        const previousVectors = this.vectors;

        // Taken now: files changed while this update runs are picked up by the next one.
        const dirty = [...this.dirty];
        this.dirty.clear();
        const files = new Map<string, number>();
        const check = async (file: string) => {
            const stat = await fs.stat(file).catch(() => undefined);
            if (stat?.isFile() && stat.size <= MAX_FILE_BYTES) {
                files.set(file, stat.mtimeMs);
            } else {
                files.delete(file);
            }
        };
        const full = !this.scanned || !this.stored;
        try {
            if (full) {
                const uris = await vscode.workspace.findFiles('**/*', EXCLUDE, MAX_FILES, token);
                await Promise.all(uris.filter((uri) => uri.scheme === 'file' && !BINARY.test(uri.fsPath)).map((uri) => check(uri.fsPath)));
            } else {
                if (!dirty.length) {
                    return;
                }
                // ponytail: new files past MAX_FILES are still added here; the next window's full scan trims back.
                for (const [file, mtime] of Object.entries(previous.mtimes)) {
                    files.set(file, mtime);
                }
                await Promise.all(dirty.map(check));
            }
        } catch (error) {
            dirty.forEach((file) => this.dirty.add(file));
            throw error;
        }
        const unchanged = new Set([...files].filter(([file, mtime]) => previous.mtimes[file] === mtime).map(([file]) => file));
        if (unchanged.size === files.size && Object.keys(previous.mtimes).length === files.size) {
            this.scanned ||= full;
            return;
        }

        // Keep the vectors of unchanged files; embed the chunks of new and changed ones.
        const kept = previous.chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => unchanged.has(chunk.file));
        const changed = [...files.keys()].filter((file) => !unchanged.has(file));
        const fresh: Array<{ chunk: Chunk; text: string }> = [];
        for (const file of changed) {
            fresh.push(...await chunksOf(file));
        }
        const vectors: number[][] = [];
        const embedAll = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
            for (let start = 0; start < fresh.length; start += BATCH_SIZE) {
                if (token?.isCancellationRequested) {
                    throw new Error('Indexing was cancelled.');
                }
                vectors.push(...await embed(client, model, fresh.slice(start, start + BATCH_SIZE).map((entry) => entry.text)));
                const done = Math.min(fresh.length, start + BATCH_SIZE);
                progress?.report({ message: `${done.toLocaleString()} / ${fresh.length.toLocaleString()} parts of ${changed.length.toLocaleString()} files`, increment: (done - start) / fresh.length * 100 });
            }
        };
        try {
            if (changed.length >= PROGRESS_FROM_FILES) {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Nova: indexing for semantic search' }, embedAll);
            } else {
                await embedAll();
            }
        } catch (error) {
            // The changed files stay changed, so the next search tries them again.
            dirty.forEach((file) => this.dirty.add(file));
            throw error;
        }
        const dims = vectors[0]?.length ?? previous.dims;
        const all = new Float32Array((kept.length + fresh.length) * dims);
        kept.forEach(({ index }, at) => all.set(previousVectors.subarray(index * dims, (index + 1) * dims), at * dims));
        vectors.forEach((vector, at) => all.set(vector, (kept.length + at) * dims));

        // Every file counts as indexed, also those without text (empty, binary), so they are not read again.
        this.stored = { model, dims, mtimes: Object.fromEntries(files), chunks: [...kept.map(({ chunk }) => chunk), ...fresh.map((entry) => entry.chunk)] };
        this.vectors = all;
        this.scanned ||= full;
        await this.save(dir);
    }

    private async load(dir: string, model: string): Promise<void> {
        if (this.stored?.model === model) {
            return;
        }
        try {
            const stored = JSON.parse(await fs.readFile(path.join(dir, 'chunks.json'), 'utf8')) as StoredIndex;
            const bytes = await fs.readFile(path.join(dir, 'vectors.f32'));
            // A different model's vectors cannot be compared with this one's: start over.
            if (stored.model === model && bytes.byteLength === stored.chunks.length * stored.dims * 4) {
                this.stored = stored;
                this.vectors = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                return;
            }
        } catch {
            // no index yet
        }
        this.stored = undefined;
        this.vectors = new Float32Array(0);
    }

    private async save(dir: string): Promise<void> {
        await ensureDir(dir);
        await fs.writeFile(path.join(dir, 'vectors.f32'), new Uint8Array(this.vectors.buffer, this.vectors.byteOffset, this.vectors.byteLength), { mode: 0o600 });
        await writePrivateFile(path.join(dir, 'chunks.json'), JSON.stringify(this.stored));
    }
}

/** Overlapping chunks of a text file, each with its path and lines in front (that helps the embedding). */
export async function chunksOf(file: string): Promise<Array<{ chunk: Chunk; text: string }>> {
    let content: string;
    try {
        content = await fs.readFile(file, 'utf8');
    } catch {
        return [];
    }
    if (content.includes('\u0000') || !content.trim()) {
        return [];
    }
    const lines = content.split(/\r?\n/);
    const chunks: Array<{ chunk: Chunk; text: string }> = [];
    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
        const end = Math.min(lines.length, start + CHUNK_LINES);
        const body = lines.slice(start, end).join('\n');
        if (body.trim()) {
            chunks.push({ chunk: { file, start: start + 1, end }, text: `${vscode.workspace.asRelativePath(file)}:${start + 1}-${end}\n${body}`.slice(0, MAX_CHUNK_CHARS) });
        }
        if (end === lines.length) {
            break;
        }
    }
    return chunks;
}

/** Embeddings in input order, normalized so a dot product is the cosine similarity. */
async function embed(client: EmbeddingClient, model: string, input: string[]): Promise<number[][]> {
    const response = await client.embeddings.create({ model, input });
    return [...response.data].sort((left, right) => left.index - right.index).map((row) => {
        const length = Math.hypot(...row.embedding) || 1;
        return row.embedding.map((value) => value / length);
    });
}

function dot(vectors: Float32Array, offset: number, query: number[]): number {
    let sum = 0;
    for (let index = 0; index < query.length; index++) {
        sum += vectors[offset + index] * query[index];
    }
    return sum;
}
