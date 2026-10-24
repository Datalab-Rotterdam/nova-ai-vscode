import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { CodeIndex } from '../../index/CodeIndex';
import { NovaTool, ToolInputError } from './types';
import { displayPath } from './workspacePaths';

export const SEMANTIC_SEARCH_TOOL = 'semantic_search';

const DEFAULT_RESULTS = 8;
const MAX_RESULTS = 20;
const SNIPPET_LINES = 12;

interface SemanticSearchInput { query: string; k?: number }

/** semantic_search: code by meaning ("where are payments retried?"), next to search_text for exact text. */
export function createSemanticSearchTool(index: CodeIndex): NovaTool<never> {
    const tool: NovaTool<SemanticSearchInput> = {
        name: SEMANTIC_SEARCH_TOOL,
        description:
            'Find code by meaning: describe what you look for in words ("where are login sessions refreshed", "retry logic for HTTP calls") and get the most related places in the workspace, best first, with a snippet each. ' +
            'Use it to find where something is handled when you do not know the names; use search_text for exact names or strings. ' +
            'The first search in a workspace builds an index, which can take a while.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'What to find, in words.' },
                k: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, description: `How many places to return (default ${DEFAULT_RESULTS}).` }
            },
            required: ['query']
        },
        readOnly: true,
        async prepare(input) {
            return { title: `Search code for "${typeof input.query === 'string' ? input.query.trim().slice(0, 80) : ''}"` };
        },
        async invoke(input, context) {
            const query = typeof input.query === 'string' ? input.query.trim() : '';
            if (!query) {
                throw new ToolInputError('A "query" is required.');
            }
            const k = Math.min(MAX_RESULTS, Math.max(1, Math.floor(input.k ?? DEFAULT_RESULTS)));
            let hits;
            try {
                hits = await index.search(query, k, context.token);
            } catch (error) {
                throw new ToolInputError(`Semantic search failed (${error instanceof Error ? error.message : String(error)}). Use search_text instead.`);
            }
            if (!hits.length) {
                return 'No results. Use search_text or find_files instead.';
            }
            const blocks = await Promise.all(hits.map(async (hit) => {
                const lines = (await fs.readFile(hit.path, 'utf8').catch(() => '')).split(/\r?\n/);
                const end = Math.min(hit.end, hit.start + SNIPPET_LINES - 1);
                const snippet = lines.slice(hit.start - 1, end).join('\n');
                return `${displayPath(vscode.Uri.file(hit.path))}:${hit.start}-${hit.end} (score ${hit.score.toFixed(2)})\n${snippet}${end < hit.end ? '\n…' : ''}`;
            }));
            return blocks.join('\n\n');
        }
    };
    return tool as unknown as NovaTool<never>;
}
