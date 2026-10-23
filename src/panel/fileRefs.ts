/*
 * File references in answers: a link to a path, or `src/app.ts:12` in inline code. Pure, so the
 * webview (which marks such code as clickable) and the extension (which opens it) share it.
 */

/** Extensions that make a bare name like `package.json` look like a file rather than `console.log`. */
const FILE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx', 'txt', 'csv', 'tsv', 'py', 'rb', 'go', 'rs',
    'java', 'kt', 'cs', 'cpp', 'cc', 'c', 'h', 'hpp', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'yml', 'yaml', 'toml', 'ini',
    'cfg', 'conf', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'svelte', 'vue', 'sql', 'graphql', 'proto', 'lock', 'env',
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'xlsx', 'docx', 'pptx', 'zip', 'gz', 'tar', 'dockerfile'
]);

export interface FileRef {
    path: string;
    /** 1-based. */
    line?: number;
    column?: number;
}

/**
 * Splits a trailing position off a path: `a.ts:12`, `a.ts:12:5`, `a.ts:12-20`, `a.ts#L12`,
 * `a.ts#L12-L20`. A path without one comes back as is.
 */
export function splitFileRef(text: string): FileRef {
    const hash = /^(.*?)#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/.exec(text);
    if (hash) {
        return { path: hash[1]!, line: Number(hash[2]), ...(hash[3] ? { column: Number(hash[3]) } : {}) };
    }
    const colon = /^(.*?):(\d+)(?::(\d+))?(?:-\d+)?$/.exec(text);
    if (colon) {
        return { path: colon[1]!, line: Number(colon[2]), ...(colon[3] ? { column: Number(colon[3]) } : {}) };
    }
    return { path: text };
}

/** True for text that is plausibly a file path (with an optional position), for example `src/app.ts:12`. */
export function looksLikeFilePath(text: string): boolean {
    if (!text || text.length > 300 || /[\s<>|*?"'`$(){}[\]=;,]|:\/\//.test(text)) {
        return false;
    }
    const { path } = splitFileRef(text);
    const name = path.split(/[\\/]/).pop() ?? '';
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
    return FILE_EXTENSIONS.has(extension) && (dot > 0 || name.toLowerCase() === 'dockerfile');
}
