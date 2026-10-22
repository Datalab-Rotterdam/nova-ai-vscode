/**
 * The codicon for a file, by its name. The webview cannot use the user's file icon theme,
 * so files get one of a few codicons and a tint per kind.
 */
export interface FileIcon {
    /** Codicon name without the `codicon-` prefix. */
    icon: string;
    /** CSS class that tints the icon (see `.file-icon` in app.scss). */
    tone: 'code' | 'data' | 'doc' | 'media' | 'config' | 'plain';
}

const BY_EXTENSION: Record<string, FileIcon> = {};
const add = (extensions: string, icon: FileIcon) => extensions.split(' ').forEach((extension) => (BY_EXTENSION[extension] = icon));

add('ts tsx js jsx mjs cjs py java go rs c h cpp hpp cc cs rb php swift kt kts scala svelte vue html htm css scss sass less sh bash zsh fish ps1 sql lua dart r pl ex exs hs ml', { icon: 'file-code', tone: 'code' });
add('json jsonc json5 geojson', { icon: 'json', tone: 'data' });
add('md mdx markdown rst adoc', { icon: 'markdown', tone: 'doc' });
add('txt log', { icon: 'file-text', tone: 'plain' });
add('png jpg jpeg webp gif bmp ico svg avif', { icon: 'file-media', tone: 'media' });
add('pdf', { icon: 'file-pdf', tone: 'doc' });
add('zip gz tgz tar rar 7z', { icon: 'file-zip', tone: 'plain' });
add('yml yaml toml ini cfg conf env properties xml', { icon: 'settings-gear', tone: 'config' });
add('lock', { icon: 'lock', tone: 'config' });
add('csv tsv sqlite db', { icon: 'database', tone: 'data' });

const BY_NAME: Record<string, FileIcon> = {
    dockerfile: { icon: 'file-code', tone: 'config' },
    makefile: { icon: 'terminal', tone: 'config' },
    '.gitignore': { icon: 'settings-gear', tone: 'config' },
    '.env': { icon: 'settings-gear', tone: 'config' },
    license: { icon: 'file-text', tone: 'plain' }
};

/** The icon for a path or file name; `:12-30` line ranges of selections are ignored. */
export function fileIcon(label: string): FileIcon {
    const name = (label.split('/').pop() ?? label).replace(/:\d+(-\d+)?$/, '').toLowerCase();
    const byName = BY_NAME[name];
    if (byName) {
        return byName;
    }
    const dot = name.lastIndexOf('.');
    return (dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined) ?? { icon: 'file', tone: 'plain' };
}
