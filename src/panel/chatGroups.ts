import type { SessionSummary } from './protocol';

/*
 * Date grouping for the chat list. No VS Code imports: the webview's Chats page uses
 * this as well as the extension.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface ChatGroup {
    key: string;
    label: string;
    chats: SessionSummary[];
}

/**
 * Chats by when they were last used: Today, Yesterday, Previous 7 days, Previous 30 days,
 * then one group per calendar month. Newest first within a group; empty groups are left out.
 */
export function groupChats(chats: readonly SessionSummary[], now = Date.now()): ChatGroup[] {
    const today = startOfDay(now);
    const recent: ChatGroup[] = [
        { key: 'today', label: 'Today', chats: [] },
        { key: 'yesterday', label: 'Yesterday', chats: [] },
        { key: 'week', label: 'Previous 7 days', chats: [] },
        { key: 'month', label: 'Previous 30 days', chats: [] }
    ];
    const bounds = [today, today - DAY, today - 7 * DAY, today - 30 * DAY];
    const months = new Map<string, ChatGroup>();

    for (const chat of [...chats].sort((left, right) => right.updatedAt - left.updatedAt)) {
        const index = bounds.findIndex((bound) => chat.updatedAt >= bound);
        if (index >= 0) {
            recent[index].chats.push(chat);
            continue;
        }
        const date = new Date(chat.updatedAt);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        let group = months.get(key);
        if (!group) {
            group = { key, label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), chats: [] };
            months.set(key, group);
        }
        group.chats.push(chat);
    }
    return [...recent, ...months.values()].filter((group) => group.chats.length > 0);
}

/** "now", "5m", "3h", "2d" within a week, then a short date. */
export function formatAge(updatedAt: number, now = Date.now()): string {
    const elapsed = Math.max(0, now - updatedAt);
    if (elapsed < 60_000) {
        return 'now';
    }
    if (elapsed < 60 * 60_000) {
        return `${Math.floor(elapsed / 60_000)}m`;
    }
    if (elapsed < DAY) {
        return `${Math.floor(elapsed / (60 * 60_000))}h`;
    }
    if (elapsed < 7 * DAY) {
        return `${Math.floor(elapsed / DAY)}d`;
    }
    const date = new Date(updatedAt);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

function startOfDay(time: number): number {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/** Chats whose title contains every word of the query, ignoring case. */
export function filterChats(chats: readonly SessionSummary[], query: string): SessionSummary[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? chats.filter((chat) => words.every((word) => chat.title.toLowerCase().includes(word))) : [...chats];
}
