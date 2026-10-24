import type { ChatItem } from './protocol';
import { visibleChatItems } from './steps';

/**
 * A chat as Markdown, to hand to a colleague or attach to an issue: the messages, answers,
 * questions and notices of the versions the chat follows, and one line per tool call.
 * Thinking and sub-agent steps are left out. The chat's details go in YAML front matter.
 * Pure, so it can be tested without VS Code.
 */
export function chatToMarkdown(
    chat: { title: string; items: readonly ChatItem[]; modelId?: string; createdAt?: number; updatedAt?: number },
    exportedAt = new Date()
): string {
    // JSON strings are valid YAML scalars, so titles with colons or quotes stay intact.
    const meta: Array<[string, string | number | undefined]> = [
        ['title', JSON.stringify(chat.title)],
        ['model', chat.modelId && JSON.stringify(chat.modelId)],
        ['created', chat.createdAt && new Date(chat.createdAt).toISOString()],
        ['updated', chat.updatedAt && new Date(chat.updatedAt).toISOString()],
        ['exported', exportedAt.toISOString()],
        ['source', '"Nova AI"']
    ];
    const lines = [
        '---',
        ...meta.filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`),
        '---',
        '',
        `# ${chat.title}`
    ];
    let speaker: 'user' | 'nova' | undefined;
    const say = (who: 'user' | 'nova', text: string) => {
        if (speaker !== who) {
            lines.push('', who === 'user' ? '## You' : '## Nova');
            speaker = who;
        }
        lines.push('', text);
    };
    for (const item of visibleChatItems(chat.items)) {
        switch (item.kind) {
            case 'user':
                say('user', item.text + (item.attachments.length ? `\n\n_Attached: ${item.attachments.join(', ')}_` : ''));
                break;
            case 'assistant':
                if (item.text.trim()) {
                    say('nova', item.text);
                }
                break;
            case 'tool':
                if (!item.agentId) {
                    say('nova', `> 🔧 ${item.title}${item.status === 'error' ? ' (failed)' : ''}`);
                }
                break;
            case 'question':
                say('nova', `> ❓ ${item.question}\n>\n> ${item.status === 'answered' ? `**Answer:** ${item.answer ?? ''}` : '_Not answered_'}`);
                break;
            case 'notice':
                say('nova', `> ${item.tone === 'info' ? 'ℹ️' : '⚠️'} ${item.text}`);
                break;
            case 'thinking':
                break;
        }
    }
    return lines.join('\n') + '\n';
}

/** The chat's title as a file name: only characters no file name may hold are dropped. */
export function exportFileName(title: string): string {
    // eslint-disable-next-line no-control-regex
    const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 200);
    return `${name || 'chat'}.md`;
}
