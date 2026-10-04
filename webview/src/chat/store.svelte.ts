import type { ChatEvent, ChatItem, ChatState } from '../../../src/panel/protocol';

/** Reactive chat state, updated from the extension's chat events. */
export function createChatStore() {
    let state = $state<ChatState | undefined>();

    function apply(event: ChatEvent): void {
        if (event.type === 'chat/state') {
            state = event.state;
            return;
        }
        if (!state) {
            return;
        }

        switch (event.type) {
            case 'chat/itemAdded':
                state.items.push(event.item);
                break;
            case 'chat/itemUpdated': {
                const index = state.items.findIndex((item) => item.id === event.item.id);
                if (index >= 0) {
                    state.items[index] = event.item;
                } else {
                    state.items.push(event.item);
                }
                break;
            }
            case 'chat/textDelta': {
                const item = state.items.find((candidate) => candidate.id === event.itemId) as Extract<ChatItem, { text: string }> | undefined;
                if (item && 'text' in item) {
                    item.text += event.delta;
                }
                break;
            }
            case 'chat/sessions':
                state.sessions = event.sessions;
                state.openElsewhere = event.openElsewhere;
                break;
            case 'chat/running':
                state.running = event.running;
                break;
            case 'chat/usage':
                state.usage = event.usage;
                break;
            case 'chat/attachments':
                state.attachments = event.attachments;
                break;
            case 'chat/queue':
                state.queue = event.queue;
                break;
            case 'chat/todos':
                state.todos = event.todos;
                break;
            case 'chat/changes':
                state.changes = event.changes;
                break;
        }
    }

    return {
        get state() {
            return state;
        },
        apply
    };
}
