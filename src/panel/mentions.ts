/**
 * The file mention of the Nova composer (`@`): shared by the webview, which offers files
 * while typing, and the tests, so it must not import `vscode` or Svelte state.
 */

/**
 * The `@` token ending at `caret` inside `text`. Returns the index of the `@` and the
 * query typed after it, or `undefined` outside mention space. A token only counts after
 * whitespace or at the start of a line. The query may contain `/`, because a natural way
 * to reach a file is to type its path (`@src/agent/…`); only a space, tab, newline or
 * backquote ends the mention.
 */
export function findMention(text: string, caret: number): { start: number; query: string } | undefined {
    const before = text.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) {
        return undefined;
    }
    const query = before.slice(start + 1);
    return /[\s`]/.test(query) ? undefined : { start, query };
}

/** How `filterMentionFiles` orders a match; lower ranks first. */
export type MentionRank = 'starts-base' | 'starts-path' | 'in-base' | 'in-path';

/**
 * Filters the workspace file paths a composer `@` offers. Ranks with the file name first
 * (where a typeahead usually lands), then the shortest name, then shorter, then
 * alphabetical paths; at most `limit` entries. With an empty query the newest-first
 * input order is kept. `/` in the query is a path separator and matches paths as typed.
 */
export function filterMentionFiles(options: readonly string[], query: string, limit = 12): string[] {
    if (!query) {
        return options.slice(0, limit);
    }
    const needle = query.toLowerCase();
    return options
        .map((path) => {
            const base = path.split(/[\\/]/).pop() ?? path;
            const lower = path.toLowerCase();
            const baseLower = base.toLowerCase();
            const rank: MentionRank | undefined = lower.startsWith(needle)
                ? baseLower.startsWith(needle) ? 'starts-base' : 'starts-path'
                : lower.includes(needle)
                    ? baseLower.includes(needle) ? 'in-base' : 'in-path'
                    : undefined;
            return { path, baseLength: base.length, rank };
        })
        .filter((candidate): candidate is { path: string; baseLength: number; rank: MentionRank } => candidate.rank !== undefined)
        .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank)
            || a.baseLength - b.baseLength
            || a.path.split(/[\\/]/).length - b.path.split(/[\\/]/).length
            || a.path.localeCompare(b.path))
        .slice(0, limit)
        .map(({ path }) => path);
}

function rankOrder(rank: MentionRank): number {
    return { 'starts-base': 0, 'starts-path': 1, 'in-base': 2, 'in-path': 3 }[rank];
}
