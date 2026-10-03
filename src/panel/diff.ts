import type { DiffLine } from './protocol';

/** Above this many cells the middle part is shown as a plain replacement instead of an exact diff. */
const MAX_LCS_CELLS = 4_000_000;
const CONTEXT_LINES = 3;

/**
 * Unified line diff with hunks and line numbers, for showing edits in the chat.
 * Common prefix and suffix are skipped first, so typical small edits stay cheap.
 */
export function diffLines(original: string, proposed: string, maxLines = 400): { lines: DiffLine[]; added: number; removed: number; truncated: boolean } {
    const before = splitLines(original);
    const after = splitLines(proposed);

    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (end < before.length - start && end < after.length - start
        && before[before.length - 1 - end] === after[after.length - 1 - end]) {
        end++;
    }

    const ops: Array<{ type: 'context' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }> = [];
    for (let index = 0; index < start; index++) {
        ops.push({ type: 'context', text: before[index], oldNo: index + 1, newNo: index + 1 });
    }
    for (const op of diffMiddle(before.slice(start, before.length - end), after.slice(start, after.length - end))) {
        ops.push({
            ...op,
            oldNo: op.oldIndex === undefined ? undefined : start + op.oldIndex + 1,
            newNo: op.newIndex === undefined ? undefined : start + op.newIndex + 1
        });
    }
    for (let index = 0; index < end; index++) {
        const oldIndex = before.length - end + index;
        const newIndex = after.length - end + index;
        ops.push({ type: 'context', text: before[oldIndex], oldNo: oldIndex + 1, newNo: newIndex + 1 });
    }

    const added = ops.filter((op) => op.type === 'add').length;
    const removed = ops.filter((op) => op.type === 'del').length;

    // Keep changed lines plus CONTEXT_LINES around them; mark gaps with hunk headers.
    const keep = new Array<boolean>(ops.length).fill(false);
    ops.forEach((op, index) => {
        if (op.type !== 'context') {
            for (let offset = -CONTEXT_LINES; offset <= CONTEXT_LINES; offset++) {
                if (index + offset >= 0 && index + offset < ops.length) {
                    keep[index + offset] = true;
                }
            }
        }
    });

    const lines: DiffLine[] = [];
    let previousKept = -1;
    for (let index = 0; index < ops.length; index++) {
        if (!keep[index]) {
            continue;
        }
        if (index !== previousKept + 1 || lines.length === 0) {
            lines.push({ type: 'hunk', text: `@@ -${firstNumber(ops, keep, index, 'oldNo')} +${firstNumber(ops, keep, index, 'newNo')} @@` });
        }
        const { type, text, oldNo, newNo } = ops[index];
        lines.push({ type, text, oldNo, newNo });
        previousKept = index;
    }

    return { lines: lines.slice(0, maxLines), added, removed, truncated: lines.length > maxLines };
}

/** First old/new line number in the hunk starting at `start` (the line before it for pure inserts/deletes). */
function firstNumber(
    ops: ReadonlyArray<{ oldNo?: number; newNo?: number }>,
    keep: readonly boolean[],
    start: number,
    key: 'oldNo' | 'newNo'
): number {
    for (let index = start; index < ops.length && keep[index]; index++) {
        const value = ops[index][key];
        if (value !== undefined) {
            return value;
        }
    }
    for (let index = start - 1; index >= 0; index--) {
        const value = ops[index][key];
        if (value !== undefined) {
            return value;
        }
    }
    return 0;
}

function diffMiddle(before: string[], after: string[]): Array<{ type: 'context' | 'add' | 'del'; text: string; oldIndex?: number; newIndex?: number }> {
    if (!before.length || !after.length || before.length * after.length > MAX_LCS_CELLS) {
        return [
            ...before.map((text, oldIndex) => ({ type: 'del' as const, text, oldIndex })),
            ...after.map((text, newIndex) => ({ type: 'add' as const, text, newIndex }))
        ];
    }

    // Longest common subsequence table, filled from the end.
    const rows = before.length;
    const cols = after.length;
    const table = new Uint32Array((rows + 1) * (cols + 1));
    for (let row = rows - 1; row >= 0; row--) {
        for (let col = cols - 1; col >= 0; col--) {
            table[row * (cols + 1) + col] = before[row] === after[col]
                ? table[(row + 1) * (cols + 1) + col + 1] + 1
                : Math.max(table[(row + 1) * (cols + 1) + col], table[row * (cols + 1) + col + 1]);
        }
    }

    const ops: Array<{ type: 'context' | 'add' | 'del'; text: string; oldIndex?: number; newIndex?: number }> = [];
    let row = 0;
    let col = 0;
    while (row < rows && col < cols) {
        if (before[row] === after[col]) {
            ops.push({ type: 'context', text: before[row], oldIndex: row++, newIndex: col++ });
        } else if (table[(row + 1) * (cols + 1) + col] >= table[row * (cols + 1) + col + 1]) {
            ops.push({ type: 'del', text: before[row], oldIndex: row++ });
        } else {
            ops.push({ type: 'add', text: after[col], newIndex: col++ });
        }
    }
    while (row < rows) {
        ops.push({ type: 'del', text: before[row], oldIndex: row++ });
    }
    while (col < cols) {
        ops.push({ type: 'add', text: after[col], newIndex: col++ });
    }
    return ops;
}

function splitLines(text: string): string[] {
    if (!text) {
        return [];
    }
    const lines = text.split(/\r?\n/);
    // A trailing newline does not start another line.
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}
