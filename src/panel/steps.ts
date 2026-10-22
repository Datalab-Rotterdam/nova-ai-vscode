/*
 * Presentation grouping of an answer's steps (the model's thinking and tool calls),
 * ported from the Nova AI desktop app (`src/lib/client/steps.ts`). Consecutive steps fold
 * into one line that expands; the line says what Nova is doing now, or what it did.
 *
 * Type-only import: this file is also used by the webview, so it must not import `vscode`.
 */
import type { ChatItem, ToolItem } from './protocol';

/** A step of an answer that is not text: the model's thinking or a tool it called. */
export type StepItem = Extract<ChatItem, { kind: 'thinking' }> | ToolItem;

/** One entry of the rendered conversation: a single item, or a group of steps. */
export type ConversationItem =
    | { kind: 'item'; item: ChatItem; index: number }
    | {
        kind: 'group';
        /** ID of the group's first step, used as the list key. */
        id: string;
        /** Position of the first step in the chat's items, for the reply header above it. */
        first: number;
        steps: StepItem[];
        /** A tool in the group waits for the user's approval, so the group must stay open. */
        awaiting: boolean;
        /** Number of failed tools in the group. */
        failed: number;
    };

const isStep = (item: ChatItem): item is StepItem => item.kind === 'thinking' || item.kind === 'tool';
/** An assistant message without text does not end a group (some models send a blank one). */
const isBlankAssistant = (item: ChatItem) => item.kind === 'assistant' && !item.text.trim();

/**
 * The items the conversation shows now: an answer run (everything after a user message,
 * marked with its `runId`) is hidden when a regenerated branch of that user message is the
 * current one. The user messages themselves stay visible, so the versions can be switched
 * back and forth without losing anything.
 */
/** The run an item belongs to (only answer steps have one). */
export const runIdOf = (item: ChatItem): string | undefined => (item as { runId?: string }).runId;

/** Tags any item with the run it belongs to, so a version's steps (answers, tools, questions) hide together. */
export const setRunId = (item: ChatItem, runId: string): void => {
    (item as { runId?: string }).runId = runId;
};

export function visibleChatItems(items: readonly ChatItem[]): ChatItem[] {
    const current = new Map<string, boolean>();
    for (const item of items) {
        if (item.kind === 'user') {
            current.set(item.id, item.branch ? item.branch.current : true);
        }
    }
    return items.filter((item) => {
        const runId = item.kind === 'user' ? item.id : runIdOf(item);
        return !runId || current.get(runId) !== false;
    });
}


/**
 * Groups consecutive steps (thinking, tool calls) into one expandable row. Anything else
 * (answer text, a user message, a question card, a notice) ends the group; the steps keep
 * their order. A single step stays on its own.
 */
export function groupItems(items: readonly ChatItem[]): ConversationItem[] {
    const result: ConversationItem[] = [];
    let run: { index: number; item: StepItem }[] = [];
    const flush = () => {
        if (run.length === 1) result.push({ kind: 'item', item: run[0]!.item, index: run[0]!.index });
        else if (run.length > 1) {
            result.push({
                kind: 'group',
                id: run[0]!.item.id,
                first: run[0]!.index,
                steps: run.map((entry) => entry.item),
                awaiting: run.some((entry) => entry.item.kind === 'tool' && entry.item.status === 'awaiting-approval'),
                failed: run.filter((entry) => entry.item.kind === 'tool' && entry.item.status === 'error').length
            });
        }
        run = [];
    };
    items.forEach((item, index) => {
        if (isStep(item)) {
            run.push({ index, item });
        } else if (!isBlankAssistant(item)) {
            flush();
            result.push({ kind: 'item', item, index });
        }
    });
    flush();
    return result;
}

/** "Thought for 8 seconds" and the like, for thinking that took `durationMs`. */
export function thoughtFor(durationMs: number | null): string {
    if (durationMs === null) return 'Thought';
    const seconds = durationMs / 1000;
    if (seconds < 1) return 'Thought for less than a second';
    const rounded = seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
    return `Thought for ${rounded} ${rounded === '1.0' ? 'second' : 'seconds'}`;
}

/** The last line of some thinking, as plain text, for a one-line glimpse of it. */
function lastLine(text: string, max = 90): string {
    const line =
        text
            .split('\n')
            .map((item) => item.replace(/[#*_`>]+/g, '').trim())
            .filter(Boolean)
            .at(-1) ?? '';
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The group's summary line. While it runs: what Nova is doing now ("Thinking: …",
 * "Reading src/a.ts · src/a.ts"). Afterwards, what it did: "Thought for 8 seconds,
 * Read a file and 2 more".
 */
export function stepsLine(steps: readonly StepItem[], running: boolean): string {
    const current = steps.at(-1);
    if (running && current) {
        if (current.kind === 'thinking') {
            const glimpse = lastLine(current.text);
            return glimpse ? `Thinking: ${glimpse}` : 'Thinking';
        }
        if (current.status === 'awaiting-approval') return `Waiting for your OK: ${current.title}`;
        return current.detail ? `${current.title} · ${current.detail}` : current.title;
    }
    const thinking = steps.filter((step): step is Extract<StepItem, { kind: 'thinking' }> => step.kind === 'thinking');
    const thought = thinking.length
        ? thoughtFor(thinking.some((step) => step.durationMs === undefined) ? null : thinking.reduce((total, step) => total + (step.durationMs ?? 0), 0))
        : null;
    const titles = [...new Set(steps.flatMap((step) => (step.kind === 'tool' ? [step.title] : [])))];
    const shown = [...(thought ? [thought] : []), ...titles].slice(0, 3);
    const more = (thought ? 1 : 0) + titles.length - shown.length;
    const line = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
    const failed = steps.filter((step) => step.kind === 'tool' && step.status === 'error').length;
    return failed ? `${line} · ${failed} failed` : line;
}
