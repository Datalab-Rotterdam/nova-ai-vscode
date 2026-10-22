import { describe, expect, it } from 'vitest';
import { groupItems, setRunId, stepsLine, thoughtFor, visibleChatItems } from '../src/panel/steps';
import type { ChatItem } from '../src/panel/protocol';

function user(text: string): ChatItem {
    return { kind: 'user', id: `u-${text}`, text, attachments: [] };
}

function assistant(text = 'Some answer.'): ChatItem {
    return { kind: 'assistant', id: `a-${text}`, text };
}

function thinking(id: string, text = 'thinking text'): ChatItem {
    return { kind: 'thinking', id, text, durationMs: 5_000 };
}

function tool(status: 'done' | 'running' | 'error' | 'awaiting-approval' = 'done', title = 'Read a.ts'): ChatItem {
    return {
        kind: 'tool',
        id: `t-${title}-${status}`,
        callId: `c-${title}`,
        name: 'read_file',
        title,
        input: '{}',
        status
    };
}

describe('groupItems', () => {
    it('keeps single steps and plain items separate', () => {
        const items = [user('q'), thinking('1'), assistant()];
        const grouped = groupItems(items);
        expect(grouped).toHaveLength(3);
        expect(grouped[0]).toMatchObject({ kind: 'item', item: items[0], index: 0 });
        expect(grouped[1]).toMatchObject({ kind: 'item', item: items[1], index: 1 });
    });

    it('folds consecutive steps into a group with their first index', () => {
        const items = [user('q'), thinking('1'), tool('done'), tool('done', 'Edit b.ts'), assistant()];
        const grouped = groupItems(items);
        expect(grouped).toHaveLength(3);
        const group = grouped[1];
        expect(group.kind).toBe('group');
        if (group.kind !== 'group') return;
        expect(group.first).toBe(1);
        expect(group.steps).toHaveLength(3);
        expect(group.awaiting).toBe(false);
        expect(group.failed).toBe(0);
    });

    it('lets answer text end a group and keeps order across runs', () => {
        const items = [thinking('1'), assistant('Mid text.'), tool('done'), tool('done', 'Edit b.ts'), assistant()];
        const grouped = groupItems(items);
        expect(grouped.map((entry) => (entry.kind === 'group' ? 'group' : entry.item.kind))).toEqual(['thinking', 'assistant', 'group', 'assistant']);
    });

    it('treats an empty assistant message as not ending a group', () => {
        const items = [thinking('1'), assistant(''), tool('done'), tool('done', 'Edit b.ts'), assistant('Answer')];
        const grouped = groupItems(items);
        expect(grouped).toHaveLength(2);
        expect(grouped[0].kind).toBe('group');
    });

    it('flags an awaiting approval so the group stays open, and counts failures', () => {
        const items = [thinking('1'), tool('done'), tool('error'), tool('awaiting-approval')];
        const grouped = groupItems(items);
        const group = grouped[0];
        expect(group.kind).toBe('group');
        if (group.kind !== 'group') return;
        expect(group.awaiting).toBe(true);
        expect(group.failed).toBe(1);
    });
});

describe('visibleChatItems', () => {
    it('shows everything when no answer has versions', () => {
        const items = [user('q'), thinking('1'), assistant(), assistant('And more.')];
        expect(visibleChatItems(items)).toHaveLength(items.length);
    });

    it('shows the current run only, whatever the order of the versions', () => {
        // A group: the host question and one regenerated version; every version points at the host.
        const host: ChatItem = { kind: 'user', id: 'host', text: 'q', attachments: [], branch: { hostId: 'host', current: false } };
        const b1: ChatItem = { kind: 'user', id: 'b1', text: 'q', attachments: [], branch: { hostId: 'host', current: true } };
        const oldAnswer = assistant('old answer');
        const newAnswer = assistant('new answer');
        setRunId(oldAnswer, 'host');
        setRunId(newAnswer, 'b1');

        expect(visibleChatItems([b1, newAnswer, host, oldAnswer]).map((item) => item.id)).toEqual(['b1', 'a-new answer']);
        expect(visibleChatItems([host, oldAnswer, b1, newAnswer]).map((item) => item.id)).toEqual(['b1', 'a-new answer']);

        // Switching back shows the old run's steps instead.
        host.branch!.current = true;
        b1.branch!.current = false;
        expect(visibleChatItems([host, oldAnswer, b1, newAnswer]).map((item) => item.id)).toEqual(['host', 'a-old answer']);
    });
});

describe('thoughtFor', () => {
    it('formats durations', () => {
        expect(thoughtFor(null)).toBe('Thought');
        expect(thoughtFor(500)).toBe('Thought for less than a second');
        expect(thoughtFor(1_000)).toBe('Thought for 1.0 second');
        expect(thoughtFor(8_000)).toBe('Thought for 8.0 seconds');
        expect(thoughtFor(65_000)).toBe('Thought for 65 seconds');
    });
});

describe('stepsLine', () => {
    const steps: ChatItem[] = [thinking('1'), tool('done', 'Read a.ts'), tool('done', 'Edit b.ts'), tool('done', 'Edit c.ts')];

    it('summarizes a finished group', () => {
        expect(stepsLine(steps, false)).toBe('Thought for 5.0 seconds, Read a.ts, Edit b.ts and 1 more');
    });

    it('counts distinct tool titles and appends the number of failed tools', () => {
        expect(stepsLine([...steps, tool('error', 'Run npm test'), tool('running', 'Search text')], false))
            .toBe('Thought for 5.0 seconds, Read a.ts, Edit b.ts and 3 more · 1 failed');
    });

    it('shows the current step while running', () => {
        expect(stepsLine([...steps, thinking('2', 'planning the next step')], true)).toBe('Thinking: planning the next step');
        expect(stepsLine([tool('running', 'Running npm test')], true)).toContain('Running npm test');
        expect(stepsLine([...steps, tool('awaiting-approval', 'Run rm -rf x')], true)).toBe('Waiting for your OK: Run rm -rf x');
    });
});
