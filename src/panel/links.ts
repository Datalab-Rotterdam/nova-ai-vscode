import * as vscode from 'vscode';

/** What a link in the chat points to. */
export type ChatLink =
    | { kind: 'external'; url: URL }
    | { kind: 'file'; path: string; line?: number }
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
    // Single letters are Windows drive letters (C:\...), not schemes.
    if (scheme && scheme.length > 1) {
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
    const line = /^L(\d+)/.exec(fragment ?? '')?.[1];
    let path: string;
    try {
        path = decodeURIComponent(pathPart.split('?', 1)[0]);
    } catch {
        path = pathPart;
    }
    return { kind: 'file', path: path.replace(/^\.\//, ''), line: line ? Number(line) : undefined };
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
