/*
 * Web search, ported from the Nova AI desktop app (`sidecar/tools/builtin/web-search.ts`
 * and `sidecar/integrations/search`): a keyless search over a small registry of providers,
 * then the top result pages are opened and cut down to the passages that match the query,
 * numbered for citation.
 *
 * The providers are plain fetch calls (no Bun APIs), so they run in the extension host.
 * Providers that fail (captcha, outage) fall through to the next enabled one.
 */
import * as vscode from 'vscode';
import { htmlToText } from './htmlToText';
import { selectPassages } from './passages';
import { NovaTool, ToolInputError, type ToolOutput } from './types';

/* ---------------------------------------------------------------- */
/* Providers                                                         */
/* ---------------------------------------------------------------- */

export interface WebResult {
    title: string;
    url: string;
    snippet: string;
}

export interface SearchProvider {
    id: string;
    name: string;
    search(query: string, options: { signal?: AbortSignal; limit?: number }): Promise<WebResult[]>;
}

const userAgent = 'Mozilla/5.0 (compatible; Nova AI; https://docs.datalabrotterdam.nl/services/nova-ai)';

const tagText = (value: string) =>
    value
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

/** DuckDuckGo wraps result links in a redirect: //duckduckgo.com/l/?uddg=<url>. */
function duckDuckGoUrl(link: string): string {
    try {
        const url = new URL(link.startsWith('//') ? `https:${link}` : link);
        return url.searchParams.get('uddg') ?? url.toString();
    } catch {
        return '';
    }
}

/** Reads DuckDuckGo's HTML results page; no key or account. */
export const duckDuckGo: SearchProvider = {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    async search(query, { signal, limit = 8 }) {
        const url = new URL('https://html.duckduckgo.com/html/');
        url.searchParams.set('q', query);
        const response = await fetch(url, { signal, headers: { 'User-Agent': userAgent, Accept: 'text/html' } });
        if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
        const html = await response.text();
        if (/anomaly-modal|challenge-form/.test(html)) {
            throw new Error('DuckDuckGo asked for a captcha. Try again later.');
        }
        return html
            .split(/<div[^>]+class="[^"]*\bresult\b[^"]*results_links/)
            .slice(1)
            .map((block) => {
                const anchor = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
                const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/.exec(block);
                return {
                    title: tagText(anchor?.[2] ?? ''),
                    url: duckDuckGoUrl(tagText(anchor?.[1] ?? '')),
                    snippet: tagText(snippet?.[1] ?? '')
                };
            })
            .filter((result) => result.title && /^https?:/.test(result.url))
            .slice(0, limit);
    }
};

/** You.com's search API for AI agents, on its free tier without a key. */
export const you: SearchProvider = {
    id: 'you',
    name: 'You.com',
    async search(query, { signal, limit = 8 }) {
        const url = new URL('https://api.you.com/v1/agents/search');
        url.searchParams.set('query', query);
        url.searchParams.set('count', String(limit));
        const response = await fetch(url, {
            signal,
            // The keyless endpoint can announce gzip with a body that fails to decode.
            headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': userAgent }
        });
        if (!response.ok) throw new Error(`You.com returned HTTP ${response.status}.`);
        const data = (await response.json()) as {
            results?: {
                web?: Array<{ url?: string; title?: string; description?: string; snippets?: string[] }>;
                news?: Array<{ url?: string; title?: string; description?: string; snippets?: string[] }>;
            };
        };
        return [...(data.results?.web ?? []), ...(data.results?.news ?? [])]
            .filter((item) => item.url && item.title)
            .map((item) => ({
                title: item.title!,
                url: item.url!,
                snippet: item.snippets?.length ? item.snippets.join(' ') : (item.description ?? '')
            }))
            .slice(0, limit);
    }
};

/** SearXNG, a metasearch engine a user or organization hosts; its JSON format must be allowed. */
export function searxng(server: string): SearchProvider {
    return {
        id: 'searxng',
        name: 'SearXNG',
        async search(query, { signal, limit = 8 }) {
            const url = new URL('search', `${server.trim().replace(/\/+$/, '')}/`);
            url.searchParams.set('q', query);
            url.searchParams.set('format', 'json');
            const response = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': userAgent } });
            if (response.status === 403) throw new Error('The SearXNG server does not allow the JSON format (search.formats in settings.yml).');
            if (!response.ok) throw new Error(`SearXNG returned HTTP ${response.status}.`);
            const data = (await response.json()) as { results?: Array<{ url?: string; title?: string; content?: string }> };
            return (data.results ?? [])
                .filter((item) => item.url && item.title)
                .map((item) => ({ title: item.title!, url: item.url!, snippet: item.content ?? '' }))
                .slice(0, limit);
        }
    };
}

/**
 * The enabled providers, in the order they are tried: the user's own server first, then
 * You.com, then DuckDuckGo.
 */
export function enabledProviders(settings: vscode.WorkspaceConfiguration): SearchProvider[] {
    const searxngUrl = settings.get<string>('searxng', '');
    const providers: SearchProvider[] = [];
    if (searxngUrl.trim()) providers.push(searxng(searxngUrl.trim()));
    if (settings.get<boolean>('you', true)) providers.push(you);
    if (settings.get<boolean>('duckduckgo', true)) providers.push(duckDuckGo);
    return providers;
}

/** Tries each provider until one returns results; undefined when none could. */
export async function searchWeb(
    query: string,
    providers: readonly SearchProvider[],
    options: { signal?: AbortSignal; limit?: number } = {}
): Promise<{ provider: string; results: WebResult[] } | undefined> {
    for (const provider of providers) {
        try {
            const results = await provider.search(query, options);
            if (results.length) {
                return { provider: provider.name, results };
            }
        } catch {
            // A provider that fails (captcha, down, blocked) falls through to the next.
        }
    }
    return undefined;
}

/* ---------------------------------------------------------------- */
/* Opening the top result pages                                      */
/* ---------------------------------------------------------------- */

export interface Page {
    url: string;
    title: string;
    text: string;
}

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** How much of each opened page is offered to the model. */
const PASSAGE_LIMIT = 6_000;
const pagesToRead = 4;

/** An abort signal that also stops when the VS Code tool call is cancelled; dispose when done. */
export function toolSignal(token: vscode.CancellationToken, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const subscription = token.onCancellationRequested(() => controller.abort());
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            subscription.dispose();
        }
    };
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) {
        return '';
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (; ;) {
        const { done, value } = await reader.read();
        if (done || !value) {
            break;
        }
        chunks.push(value);
        total += value.length;
        if (total >= maxBytes) {
            await reader.cancel();
            break;
        }
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Opens a search result page and returns its readable text. */
export async function openSearchPage(url: string, token: vscode.CancellationToken): Promise<Page> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`"${url}" is not a valid URL.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http and https pages can be opened.');
    }
    const { signal, dispose } = toolSignal(token, PAGE_TIMEOUT_MS);
    try {
        const response = await fetch(parsed, { signal, redirect: 'follow', headers: { 'User-Agent': userAgent, Accept: 'text/html,text/plain;q=0.9' } });
        if (!response.ok) {
            throw new Error(`The page returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        const body = await readLimited(response, PAGE_MAX_BYTES);
        const finalUrl = response.url || parsed.toString();
        const isHtml = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body.slice(0, 200));
        if (isHtml) {
            const { title, text } = htmlToText(body, finalUrl);
            return { url: finalUrl, title: title || parsed.hostname, text };
        }
        if (/^(text\/|application\/(json|javascript|x-yaml|yaml))/i.test(contentType) || !contentType) {
            return { url: finalUrl, title: parsed.hostname, text: body };
        }
        throw new Error(`This page is ${contentType}, which cannot be read as text.`);
    } finally {
        dispose();
    }
}

/* ---------------------------------------------------------------- */
/* The tool                                                          */
/* ---------------------------------------------------------------- */

interface WebSearchInput {
    query: string;
}

/**
 * Formats the search results and opened passages for the model: numbered sources that the
 * answer cites as [1], [2], …. Pages that could not be opened fall back to their snippet.
 */
export function formatSearchOutput(
    provider: string,
    query: string,
    results: readonly WebResult[],
    pages: ReadonlyMap<string, Page | undefined>
): ToolOutput {
    const lines = [`Searched the web with ${provider} for "${query}". Cite the sources below as [1], [2], … in the answer.`];
    results.forEach((result, index) => {
        const body = pages.get(result.url)?.text ? selectPassages(pages.get(result.url)!.text.trim(), query, PASSAGE_LIMIT) : (result.snippet || '(no snippet)');
        lines.push(`[${index + 1}] ${result.title}\n${result.url}\n${body}`);
    });
    return { text: lines.join('\n\n'), images: [] };
}

/**
 * The web_search tool: finds current information with the enabled keyless providers,
 * opens the top pages, and returns their matching passages numbered for citation.
 */
export const webSearchTool: NovaTool<WebSearchInput> = {
    name: 'web_search',
    description:
        'Search the web for current or external information: news, recent events, prices, opening times, documentation, or facts you are unsure about. ' +
        'It searches with keyless providers and opens the top result pages, so prefer it over fetch_url when you do not have the exact page yet. ' +
        'Returns numbered sources; cite them in your answer as [1], [2], ….',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'A concise search query, as you would type it.' }
        },
        required: ['query'],
        additionalProperties: false
    },
    readOnly: true,
    async prepare(input) {
        return { title: 'Search the web', detail: queryOf(input.query) };
    },
    async invoke(input, context): Promise<string | ToolOutput> {
        const query = queryOf(input.query);
        const providers = enabledProviders(vscode.workspace.getConfiguration('nova.webSearch'));
        const { signal, dispose } = toolSignal(context.token, 30_000);
        try {
            const found = await searchWeb(query, providers, { signal, limit: 8 });
            if (!found) {
                return 'No web search provider returned results (they may be unreachable or blocked). Answer without web results and say so.';
            }
            // Open the top pages in parallel so one slow page does not hold the rest;
            // a page that fails falls back to its search snippet.
            const top = found.results.slice(0, pagesToRead);
            const settled = await Promise.allSettled(top.map((result) => openSearchPage(result.url, context.token)));
            const pages = new Map<string, Page | undefined>();
            top.forEach((result, index) => {
                const entry = settled[index];
                pages.set(result.url, entry?.status === 'fulfilled' ? entry.value : undefined);
            });
            return formatSearchOutput(found.provider, query, found.results, pages);
        } finally {
            dispose();
        }
    }
};

const queryOf = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 300) : '');
