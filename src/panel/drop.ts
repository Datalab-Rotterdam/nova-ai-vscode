/**
 * What the Nova composer accepts from a paste or a drop: shared by the webview, which
 * inspects the clipboard and drag data, and the tests, so it must not import `vscode`
 * or Svelte state.
 */

export interface DataSource {
    readonly types: readonly string[];
    getData(type: string): string;
}

/**
 * The `file:` URIs inside drag or clipboard data. VS Code puts the Explorer and editor-tab
 * resources in `resourceurls` (a JSON array) and `text/uri-list`; a file copied from the
 * Explorer pastes as a plain `file:` URI. Anything that is not a `file:` URI is ignored.
 */
export function parseDroppedUris(source: DataSource): string[] {
    const found: string[] = [];
    const add = (candidate: unknown) => {
        if (typeof candidate === 'string' && /^file:\/\//i.test(candidate.trim())) {
            found.push(candidate.trim());
        }
    };

    for (const type of ['resourceurls', 'ResourceURLs']) {
        if (!source.types.includes(type)) {
            continue;
        }
        try {
            const parsed: unknown = JSON.parse(source.getData(type));
            if (Array.isArray(parsed)) {
                parsed.forEach(add);
            }
        } catch {
            // not JSON: fall through to the text types
        }
    }
    for (const type of ['text/uri-list', 'text/plain']) {
        if (!source.types.includes(type)) {
            continue;
        }
        for (const line of source.getData(type).split(/\r?\n/)) {
            if (line.trim() && !line.startsWith('#')) {
                add(line);
            }
        }
    }
    return [...new Set(found)];
}

/** Whether `text` is nothing but `file:` URIs, one per line: a copied Explorer file. */
export function isOnlyFileUris(text: string): boolean {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length > 0 && lines.every((line) => /^file:\/\/\S+$/i.test(line));
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const BINARY_EXTENSIONS = new Set([
    'pdf', 'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'jar', 'wasm',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'gif', 'bmp', 'tiff', 'ico', 'heic', 'svgz',
    'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'woff', 'woff2', 'ttf', 'otf', 'sqlite', 'db'
]);

export type FileKind = 'image' | 'text' | 'unsupported';

/** Sorts a file by name and MIME type: an image Nova can see, text to inline, or neither. */
export function classifyFile(name: string, mime = ''): FileKind {
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXTENSIONS.has(extension) || /^image\/(png|jpeg|webp)$/.test(mime)) {
        return 'image';
    }
    if (BINARY_EXTENSIONS.has(extension) || /^(image|audio|video)\//.test(mime) || mime === 'application/pdf' || mime === 'application/zip' || mime === 'application/octet-stream') {
        return 'unsupported';
    }
    return 'text';
}
