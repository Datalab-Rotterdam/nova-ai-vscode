import * as vscode from 'vscode';
import type { ChatController } from './ChatController';

/**
 * The chat controllers of this window: the sidebar's and one per editor tab. A chat is
 * open in at most one of them, so two places never write the same session file; asking
 * to open it elsewhere reveals the place that has it.
 */
export class ChatHub implements vscode.Disposable {
    private readonly controllers = new Set<ChatController>();
    private readonly changed = new vscode.EventEmitter<void>();
    /** A controller was added or removed, or opened another chat. */
    public readonly onDidChange = this.changed.event;

    public add(controller: ChatController): void {
        this.controllers.add(controller);
        this.changed.fire();
    }

    public remove(controller: ChatController): void {
        if (this.controllers.delete(controller)) {
            this.changed.fire();
        }
    }

    /** The controller (other than `except`) that has this chat open. */
    public ownerOf(sessionId: string, except?: ChatController): ChatController | undefined {
        for (const controller of this.controllers) {
            if (controller !== except && controller.currentSessionId === sessionId) {
                return controller;
            }
        }
        return undefined;
    }

    /** Chats open in other places than `except`. */
    public openElsewhere(except: ChatController): string[] {
        return [...this.controllers].filter((controller) => controller !== except).map((controller) => controller.currentSessionId);
    }

    public notify(): void {
        this.changed.fire();
    }

    public dispose(): void {
        this.changed.dispose();
    }
}
