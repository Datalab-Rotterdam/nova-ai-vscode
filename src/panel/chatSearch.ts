import * as vscode from 'vscode';
import { formatAge } from './chatGroups';
import type { SessionSummary } from './protocol';

/** What the chat list needs from the chat panel; the ACP client can provide the same later. */
export interface ChatHistory {
    readonly currentSessionId: string;
    readonly isRunning: boolean;
    listSessions(): SessionSummary[];
    openSession(sessionId: string): Promise<boolean>;
    renameSession(sessionId: string, title: string): Promise<void>;
    deleteSessions(sessionIds: readonly string[]): Promise<void>;
}

const MAX_TITLE_LENGTH = 200;

/** Asks before deleting; true when the chats were deleted. */
export async function confirmAndDeleteChats(history: ChatHistory, sessionIds: readonly string[]): Promise<boolean> {
    const chats = history.listSessions().filter((chat) => sessionIds.includes(chat.id));
    if (!chats.length) {
        return false;
    }
    const working = history.isRunning && chats.some((chat) => chat.id === history.currentSessionId);
    const answer = await vscode.window.showWarningMessage(
        chats.length === 1 ? `Delete the chat "${chats[0].title}"?` : `Delete ${chats.length} chats?`,
        { modal: true, detail: `${working ? 'Nova stops working on it. ' : ''}This cannot be undone.` },
        'Delete'
    );
    if (answer !== 'Delete') {
        return false;
    }
    await history.deleteSessions(chats.map((chat) => chat.id));
    return true;
}

export async function promptRenameChat(history: ChatHistory, chat: SessionSummary): Promise<void> {
    const title = await vscode.window.showInputBox({
        title: 'Rename Chat',
        prompt: 'New name for this chat',
        value: chat.title,
        valueSelection: [0, chat.title.length],
        validateInput: (value) => !value.trim()
            ? 'Enter a name.'
            : value.trim().length > MAX_TITLE_LENGTH ? `At most ${MAX_TITLE_LENGTH} characters.` : undefined
    });
    if (title?.trim() && title.trim() !== chat.title) {
        await history.renameSession(chat.id, title.trim());
    }
}

/**
 * "Nova AI: Search Chats": all chats in a quick pick, with rename and delete buttons.
 * Rename and delete show their own dialogs (which close the list), so it reopens after.
 */
export async function searchChats(history: ChatHistory, afterOpen: () => Promise<void>): Promise<void> {
    for (;;) {
        const choice = await pickChat(history);
        if (!choice) {
            return;
        }
        if (choice.action === 'open') {
            if (await history.openSession(choice.chat.id)) {
                await afterOpen();
            }
            return;
        }
        if (choice.action === 'rename') {
            await promptRenameChat(history, choice.chat);
        } else {
            await confirmAndDeleteChats(history, [choice.chat.id]);
        }
        if (!history.listSessions().length) {
            return;
        }
    }
}

type Choice = { action: 'open' | 'rename' | 'delete'; chat: SessionSummary };

function pickChat(history: ChatHistory): Promise<Choice | undefined> {
    const renameButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Rename' };
    const deleteButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete' };
    type ChatPick = vscode.QuickPickItem & { chat: SessionSummary };

    const pick = vscode.window.createQuickPick<ChatPick>();
    pick.title = 'Nova Chats';
    pick.placeholder = history.listSessions().length ? 'Search chats by name' : 'No chats in this workspace yet';
    pick.items = history.listSessions().map((chat) => ({
        chat,
        label: chat.title || 'Untitled chat',
        description: `${chat.id === history.currentSessionId ? 'open · ' : ''}${formatAge(chat.updatedAt)}`,
        buttons: [renameButton, deleteButton]
    }));
    return new Promise((resolve) => {
        let result: Choice | undefined;
        pick.onDidAccept(() => {
            const chosen = pick.selectedItems[0];
            result = chosen ? { action: 'open', chat: chosen.chat } : undefined;
            pick.hide();
        });
        pick.onDidTriggerItemButton(({ item, button }) => {
            result = { action: button === renameButton ? 'rename' : 'delete', chat: item.chat };
            pick.hide();
        });
        pick.onDidHide(() => {
            pick.dispose();
            resolve(result);
        });
        pick.show();
    });
}
