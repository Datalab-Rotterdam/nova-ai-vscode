import * as vscode from 'vscode';
import { htmlToText } from './htmlToText';
import { NovaTool, ToolInputError } from './types';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_BYTES = 3_000_000;
const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 60_000;

export interface FetchUrlInput {
    url: string;
    /** Character offset to continue reading a long page. */
    startChar?: number;
}

export const fetchUrlTool: NovaTool<FetchUrlInput> = {
    name: 'fetch_url',
    description:
        'Fetch a web page (http or https) and return its main content as text with links, or the raw body for text and JSON. ' +
        'Use it to read documentation, issues or articles the user refers to. Long pages are cut; pass startChar to read on. ' +
        'You cannot search the web: you need a concrete URL.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Absolute http(s) URL.' },
            startChar: { type: 'integer', minimum: 0, description: 'Character offset to continue from (shown at the end of a cut page).' }
        },
        required: ['url']
    },
    // Fetching sends a request to a third party (and could leak data placed in the URL), so it needs approval.
    readOnly: false,
    async prepare(input) {
        const url = parseUrl(input.url);
        return { title: `Fetch ${url.host}`, detail: url.toString() };
    },
    async invoke(input, context) {
        return fetchUrl(parseUrl(input.url), input.startChar ?? 0, context.token);
    }
};

export function parseUrl(value: unknown): URL {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ToolInputError('A "url" is required.');
    }
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new ToolInputError(`"${value}" is not a valid absolute URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ToolInputError('Only http and https URLs can be fetched.');
    }
    if (url.username || url.password) {
        throw new ToolInputError('URLs with credentials are not allowed.');
    }
    return url;
}

export async function fetchUrl(url: URL, startChar: number, token: vscode.CancellationToken): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const subscription = token.onCancellationRequested(() => controller.abort());

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': `Nova-AI-VSCode/${vscode.version} (+https://docs.datalabrotterdam.nl/services/nova-ai)`,
                Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5'
            }
        });

        const contentType = response.headers.get('content-type') ?? '';
        const body = await readLimited(response, MAX_DOWNLOAD_BYTES);
        const status = response.ok ? '' : `HTTP ${response.status} ${response.statusText}\n`;

        let title: string | undefined;
        let text: string;
        if (/html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body.slice(0, 200))) {
            ({ title, text } = htmlToText(body, response.url || url.toString()));
        } else if (/^(text\/|application\/(json|javascript|x-yaml|yaml|xml))/i.test(contentType) || !contentType) {
            text = body;
        } else {
            return `${status}Cannot read ${contentType} content from ${response.url || url}.`;
        }

        const offset = Math.max(0, Math.min(startChar, text.length));
        const slice = text.slice(offset, offset + Math.min(DEFAULT_MAX_CHARS, MAX_CHARS));
        const end = offset + slice.length;
        const more = end < text.length ? `\n\n[Page cut at character ${end} of ${text.length}. Call fetch_url again with startChar=${end} to read on.]` : '';
        const header = [`URL: ${response.url || url}`, title ? `Title: ${title}` : undefined].filter(Boolean).join('\n');
        return `${status}${header}\n\n${slice || '(no readable text)'}${more}`;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(token.isCancellationRequested ? 'Fetch cancelled.' : `Fetching ${url} timed out after ${FETCH_TIMEOUT_MS / 1000}s.`);
        }
        throw new Error(`Fetching ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        clearTimeout(timer);
        subscription.dispose();
    }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) {
        return '';
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
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
