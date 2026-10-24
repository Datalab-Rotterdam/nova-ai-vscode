import type { ChatItem } from './protocol';
import { visibleChatItems } from './steps';

/**
 * A chat as Markdown, to hand to a colleague or attach to an issue: the messages, answers,
 * questions and notices of the versions the chat follows, and one line per tool call.
 * Thinking and sub-agent steps are left out. Pure, so it can be tested without VS Code.
 */
export function chatToMarkdown(chat: { title: string; items: readonly ChatItem[]; modelId?: string }, exportedAt = new Date()): string {
    const lines = [`# ${chat.title}`, '', `_Exported from Nova AI on ${exportedAt.toISOString().slice(0, 10)}${chat.modelId ? ` · ${chat.modelId}` : ''}_`];
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

/** A file name for the chat's title. */
export function exportFileName(title: string): string {
    return `${title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'chat'}.md`;
}
