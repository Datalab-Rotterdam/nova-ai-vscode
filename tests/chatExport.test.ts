import { describe, expect, it } from 'vitest';
import { chatToMarkdown, exportFileName } from '../src/panel/chatExport';
import type { ChatItem } from '../src/panel/protocol';

const tool = (id: string, extra: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): ChatItem => ({
    kind: 'tool', id, callId: id, name: 'read_file', title: 'Read src/a.ts', input: '{}', status: 'done', ...extra
});

describe('chatExport', () => {
    it('writes the followed conversation and leaves out thinking, old versions and sub-agent steps', () => {
        const items: ChatItem[] = [
            { kind: 'user', id: 'u1', text: 'Fix the bug', attachments: ['a.ts'] },
            { kind: 'thinking', id: 't1', text: 'hmm', runId: 'u1' },
            tool('c1', { runId: 'u1' }),
            tool('c2', { runId: 'u1', agentId: 'agent-1', title: 'Hidden step' }),
            { kind: 'assistant', id: 'a1', text: 'Fixed.', runId: 'u1' },
            { kind: 'user', id: 'u2', text: 'Old question', attachments: [], branch: { hostId: 'u2', current: false } },
            { kind: 'assistant', id: 'a2', text: 'Old answer', runId: 'u2' },
            { kind: 'user', id: 'u3', text: 'New question', attachments: [], branch: { hostId: 'u2', current: true } },
            { kind: 'question', id: 'q1', question: 'Which file?', options: [], multiSelect: false, allowOther: true, status: 'answered', answer: 'b.ts', runId: 'u3' } as ChatItem,
            tool('c3', { runId: 'u3', status: 'error', title: 'Edit b.ts' }),
            { kind: 'notice', id: 'n1', text: 'Rate limited', tone: 'warning' }
        ];
        expect(chatToMarkdown({ title: 'Bug hunt', items, modelId: 'nova-1' }, new Date('2026-10-24T12:00:00Z'))).toBe([
            '# Bug hunt', '', '_Exported from Nova AI on 2026-10-24 · nova-1_',
            '', '## You', '', 'Fix the bug\n\n_Attached: a.ts_',
            '', '## Nova', '', '> 🔧 Read src/a.ts', '', 'Fixed.',
            '', '## You', '', 'New question',
            '', '## Nova', '', '> ❓ Which file?\n>\n> **Answer:** b.ts', '', '> 🔧 Edit b.ts (failed)', '', '> ⚠️ Rate limited',
            ''
        ].join('\n'));
    });

    it('makes a safe file name', () => {
        expect(exportFileName('Fix: a/b "bug"?')).toBe('Fix-a-b-bug.md');
        expect(exportFileName('???')).toBe('chat.md');
    });
});
