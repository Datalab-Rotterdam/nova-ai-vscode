import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { chunksOf, CodeIndex, type EmbeddingClient } from '../src/index/CodeIndex';
import { createSemanticSearchTool } from '../src/agent/tools/semanticSearchTool';

let dir: string;
const WORDS = ['login', 'session', 'payment', 'retry', 'chart'];

/** Embeds a text as counts of a few words, so "closest" is predictable. */
function fakeClient(models = [{ id: 'chat' }, { id: 'embedder', capabilities: ['embedding'] }]) {
    const create = vi.fn(async ({ input }: { model: string; input: string[] }) => ({
        data: input.map((text, index) => ({ index, embedding: WORDS.map((word) => (text.toLowerCase().match(new RegExp(word, 'g')) ?? []).length + 0.01) }))
    }));
    const client: EmbeddingClient = { models: { list: async () => ({ data: models }) }, embeddings: { create } };
    return { client, create };
}

function index(client: EmbeddingClient | undefined) {
    return new CodeIndex({ client: async () => client, dir: () => path.join(dir, 'index') });
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nova-index-'));
    writeFileSync(path.join(dir, 'auth.ts'), 'export function login() {\n  // refresh the login session\n}\n');
    writeFileSync(path.join(dir, 'billing.ts'), 'export function pay() {\n  // retry the payment\n}\n');
    writeFileSync(path.join(dir, 'empty.ts'), '');
    vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(async () => ['auth.ts', 'billing.ts', 'empty.ts'].map((name) => vscode.Uri.file(path.join(dir, name))));
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
});

describe('code index', () => {
    it('cuts files into overlapping chunks of lines, with the path and lines in front', async () => {
        const file = path.join(dir, 'long.ts');
        writeFileSync(file, Array.from({ length: 130 }, (_, line) => `line ${line + 1}`).join('\n'));
        const chunks = await chunksOf(file);
        expect(chunks.map(({ chunk }) => [chunk.start, chunk.end])).toEqual([[1, 60], [51, 110], [101, 130]]);
        expect(chunks[0].text.split('\n')[0]).toMatch(/long\.ts:1-60$/);
        expect(await chunksOf(path.join(dir, 'empty.ts'))).toEqual([]);
    });

    it('uses the first model with the embedding capability, and is not offered without one', async () => {
        expect(await index(fakeClient().client).embeddingModel()).toBe('embedder');
        expect(await index(fakeClient([{ id: 'chat' }]).client).available()).toBe(false);
        expect(await index(undefined).available()).toBe(false);
    });

    it('finds code by meaning, best first, and stores the index in the project folder', async () => {
        const { client } = fakeClient();
        const hits = await index(client).search('where is the payment retried?', 2);
        expect(hits.map((hit) => path.basename(hit.path))).toEqual(['billing.ts', 'auth.ts']);
        expect(hits[0]).toMatchObject({ start: 1, end: 4 });
        expect(existsSync(path.join(dir, 'index', 'chunks.json'))).toBe(true);
        expect(existsSync(path.join(dir, 'index', 'vectors.f32'))).toBe(true);
    });

    it('embeds only new and changed files on later searches, also after a reload', async () => {
        const { client, create } = fakeClient();
        await index(client).search('login', 1);
        expect(create).toHaveBeenCalledTimes(2); // the chunks, then the query

        // A new instance (a reload) reads the stored index and embeds nothing but the query.
        const reloaded = index(client);
        expect(path.basename((await reloaded.search('login session', 1))[0].path)).toBe('auth.ts');
        expect(create).toHaveBeenCalledTimes(3);

        writeFileSync(path.join(dir, 'billing.ts'), 'export function chart() {\n  // draw a chart chart\n}\n');
        const later = Date.now() / 1000 + 5;
        (await import('node:fs')).utimesSync(path.join(dir, 'billing.ts'), later, later);
        expect(path.basename((await reloaded.search('chart', 1))[0].path)).toBe('billing.ts');
        expect(create.mock.calls[3][0].input).toHaveLength(1);
        expect(create.mock.calls[3][0].input[0]).toContain('billing.ts:1-4');
    });

    it('serves the semantic_search tool with snippets, and points to search_text when it fails', async () => {
        const tool = createSemanticSearchTool(index(fakeClient().client)) as never as { invoke(input: unknown, context: unknown, preparation: unknown): Promise<string> };
        const output = await tool.invoke({ query: 'login session', k: 1 }, { token: new vscode.CancellationTokenSource().token }, {});
        expect(output).toMatch(/auth\.ts:1-4 \(score [\d.]+\)\nexport function login\(\) \{/);

        const broken = createSemanticSearchTool(index({ models: { list: async () => ({ data: [{ id: 'e', capabilities: ['embedding'] }] }) }, embeddings: { create: async () => { throw new Error('503'); } } })) as never as { invoke(input: unknown, context: unknown, preparation: unknown): Promise<string> };
        await expect(broken.invoke({ query: 'x' }, { token: new vscode.CancellationTokenSource().token }, {})).rejects.toThrow(/Use search_text instead/);
    });
});
