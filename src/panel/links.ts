import * as vscode from 'vscode';
import { splitFileRef } from './fileRefs';

/** What a link in the chat points to. */
export type ChatLink =
    | { kind: 'external'; url: URL }
    | { kind: 'file'; path: string; line?: number; column?: number }
    | { kind: 'blocked'; reason: string };

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * Classifies a link from model output. Web and mail links open in the browser after confirmation,
 * relative paths open as workspace files, and every other scheme (command:, vscode:, file:, javascript:, …)
 * is refused so a reply cannot run commands or reach outside the workspace.
 */
export function classifyLink(href: string): ChatLink {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return { kind: 'blocked', reason: 'This link does not point anywhere.' };
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1];
    // `file:` links point to a path; the chat opens it in the workspace or shows it in the file manager.
    if (scheme?.toLowerCase() === 'file') {
        return fileLink(trimmed);
    }
    // `a.ts:12` is a file and a line, not a scheme.
    const isPosition = /^[^:/\\]+:\d+(?::\d+)?(?:-\d+)?$/.test(trimmed);
    // Single letters are Windows drive letters (C:\...), not schemes.
    if (scheme && scheme.length > 1 && !isPosition) {
        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            return { kind: 'blocked', reason: 'This link is not a valid address.' };
        }
        if (!EXTERNAL_SCHEMES.has(url.protocol)) {
            return { kind: 'blocked', reason: `Nova does not open ${url.protocol} links from the chat.` };
        }
        return { kind: 'external', url };
    }
    if (trimmed.startsWith('//')) {
        return { kind: 'blocked', reason: 'This link has no scheme.' };
    }
    const [pathPart, fragment] = trimmed.split('#', 2);
    const fromFragment = /^L(\d+)(?:C(\d+))?/.exec(fragment ?? '');
    const target = splitFileRef(pathPart.split('?', 1)[0]);
    let path: string;
    try {
        path = decodeURIComponent(target.path);
    } catch {
        path = target.path;
    }
    const line = target.line ?? (fromFragment ? Number(fromFragment[1]) : undefined);
    const column = target.column ?? (fromFragment?.[2] ? Number(fromFragment[2]) : undefined);
    return { kind: 'file', path: path.replace(/^\.\//, ''), line, ...(column ? { column } : {}) };
}

/** A `file:` link as a path (the chat decides whether it is in the workspace). */
function fileLink(href: string): ChatLink {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return { kind: 'blocked', reason: 'This link is not a valid address.' };
    }
    if (url.hostname && url.hostname !== 'localhost') {
        return { kind: 'blocked', reason: 'Nova does not open files on other machines.' };
    }
    let path = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:/.test(path)) {
        path = path.slice(1); // file:///C:/dir → C:/dir
    }
    const fromFragment = /^L(\d+)(?:C(\d+))?/.exec(url.hash.slice(1));
    return {
        kind: 'file',
        path,
        line: fromFragment ? Number(fromFragment[1]) : undefined,
        ...(fromFragment?.[2] ? { column: Number(fromFragment[2]) } : {})
    };
}

/** Host of `text` when the visible link text is itself an address on a different host than the link. */
export function misleadingHost(text: string, url: URL): string | undefined {
    const match = /^\s*(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?\s*$/i.exec(text);
    if (!match || url.protocol === 'mailto:') {
        return undefined;
    }
    const shown = match[1].toLowerCase().replace(/^www\./, '');
    const real = url.hostname.toLowerCase().replace(/^www\./, '');
    return shown === real ? undefined : shown;
}

/** Shows where an external link goes and opens it in the browser only when the user confirms. */
export async function confirmAndOpenExternal(url: URL, text: string): Promise<boolean> {
    const target = url.protocol === 'mailto:' ? url.pathname : url.hostname;
    const shownHost = misleadingHost(text, url);
    const details = [
        url.href,
        shownHost ? `\nWarning: the link text says ${shownHost}, but the link goes to ${url.hostname}.` : '',
        url.protocol === 'http:' ? '\nThis link does not use a secure connection (http).' : ''
    ].join('');
    const open = url.protocol === 'mailto:' ? 'Open Mail App' : 'Open in Browser';
    const choice = await vscode.window.showWarningMessage(
        url.protocol === 'mailto:' ? `Write an email to ${target}?` : `Open ${target} in your browser?`,
        { modal: true, detail: details },
        open,
        'Copy Link'
    );
    if (choice === 'Copy Link') {
        await vscode.env.clipboard.writeText(url.href);
        return false;
    }
    if (choice !== open) {
        return false;
    }
    return vscode.env.openExternal(vscode.Uri.parse(url.href, true));
}
