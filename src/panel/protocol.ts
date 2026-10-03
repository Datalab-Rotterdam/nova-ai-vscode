/**
 * Messages and view models shared by the Nova chat panel (extension) and its webview.
 * Type-only: the webview bundle imports this file, so it must not import `vscode`.
 */

export type ChatItem =
    | {
        kind: 'user';
        id: string;
        text: string;
        attachments: string[];
        steered?: boolean;
        /** Attachments as sent, so an edited message can be resent with them. */
        files?: Attachment[];
        /** Position of this message in the model conversation, used to cut it on edit. */
        messageIndex?: number;
    }
    | { kind: 'assistant'; id: string; text: string }
    | { kind: 'thinking'; id: string; text: string }
    | ToolItem
    | QuestionItem
    | { kind: 'notice'; id: string; text: string; tone: 'info' | 'warning' | 'error' };

/** A question Nova asked with the ask_user tool. */
export interface QuestionItem {
    kind: 'question';
    id: string;
    question: string;
    options: QuestionOption[];
    /** Several options may be picked. */
    multiSelect: boolean;
    /** A free-text answer is allowed besides the options. */
    allowOther: boolean;
    status: 'pending' | 'answered' | 'skipped';
    answer?: string;
}

export interface QuestionOption {
    label: string;
    /** What choosing this option means. */
    description?: string;
    /** Nova's suggestion; shown with a badge and pre-selected. */
    recommended?: boolean;
}

/** Task list Nova maintains with the todo_write tool. */
export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}

export type ToolStatus = 'awaiting-approval' | 'running' | 'done' | 'error' | 'rejected';

export interface ToolItem {
    kind: 'tool';
    id: string;
    callId: string;
    name: string;
    title: string;
    detail?: string;
    input: string;
    status: ToolStatus;
    output?: string;
    /** Path of a proposed or applied edit; the card offers "Open diff". */
    editPath?: string;
    /** Rule "Always allow" would add to .nova-ai/settings.local.json. */
    allowRule?: string;
    /** Changed lines of an applied edit, shown in the card. */
    diff?: { lines: DiffLine[]; added: number; removed: number; truncated: boolean };
}

export interface DiffLine {
    type: 'context' | 'add' | 'del' | 'hunk';
    text: string;
    oldNo?: number;
    newNo?: number;
}

/** A file Nova changed in this chat that the user has not kept or undone yet. */
export interface FileChange {
    path: string;
    added: number;
    removed: number;
    /** Nova created the file (undo deletes it). */
    created: boolean;
}

export interface ChatModelOption {
    id: string;
    name: string;
    maxInputTokens: number;
}

export interface Attachment {
    id: string;
    label: string;
    /** Workspace-relative path. */
    path: string;
    /** 1-based inclusive line range for selections. */
    lines?: [number, number];
}

/**
 * A message sent while Nova is working. `steer` is injected at Nova's next step;
 * `queue` is sent as a new message after the current reply.
 */
export interface QueuedMessage {
    id: string;
    text: string;
    attachments: string[];
    mode: 'steer' | 'queue';
}

export interface SessionSummary {
    id: string;
    title: string;
    updatedAt: number;
}

export interface ChatState {
    sessionId: string;
    title: string;
    items: ChatItem[];
    running: boolean;
    models: ChatModelOption[];
    modelId?: string;
    attachments: Attachment[];
    /** Prompt tokens of the last request and the model's input budget. */
    usage?: { used: number; total: number };
    sessions: SessionSummary[];
    approvalMode: ApprovalMode;
    queue: QueuedMessage[];
    /** Nova's task list for the current work; empty when there is none or it was closed. */
    todos: TodoItem[];
    /** Files Nova changed that are waiting for Keep or Undo. */
    changes: FileChange[];
}

export type ApprovalMode = 'ask' | 'autoReadOnly' | 'autoAll';

export type ApprovalDecision = 'approve' | 'approveSession' | 'approveAlways' | 'reject';

/** Extension → webview. */
export type ChatEvent =
    | { type: 'chat/state'; state: ChatState }
    | { type: 'chat/itemAdded'; item: ChatItem }
    | { type: 'chat/itemUpdated'; item: ChatItem }
    | { type: 'chat/textDelta'; itemId: string; delta: string }
    | { type: 'chat/running'; running: boolean }
    | { type: 'chat/usage'; usage: { used: number; total: number } }
    | { type: 'chat/attachments'; attachments: Attachment[] }
    | { type: 'chat/queue'; queue: QueuedMessage[] }
    | { type: 'chat/todos'; todos: TodoItem[] }
    | { type: 'chat/changes'; changes: FileChange[] };

/** Webview → extension. */
export type ChatCommand =
    | { command: 'chat/ready' }
    | { command: 'chat/send'; text: string }
    | { command: 'chat/stop' }
    | { command: 'chat/approval'; itemId: string; decision: ApprovalDecision }
    | { command: 'chat/new' }
    | { command: 'chat/open'; sessionId: string }
    | { command: 'chat/delete'; sessionId: string }
    | { command: 'chat/selectModel'; modelId: string }
    | { command: 'chat/addFile' }
    | { command: 'chat/addSelection' }
    | { command: 'chat/removeAttachment'; id: string }
    | { command: 'chat/openDiff'; itemId: string }
    | { command: 'chat/openFile'; path: string }
    | { command: 'chat/setApprovalMode'; mode: ApprovalMode }
    | { command: 'chat/queueMode'; id: string; mode: QueuedMessage['mode'] }
    | { command: 'chat/queueRemove'; id: string }
    | { command: 'chat/queueSendNow'; id: string }
    | { command: 'chat/editMessage'; itemId: string; text: string }
    | { command: 'chat/answer'; itemId: string; answer: string }
    | { command: 'chat/skipQuestion'; itemId: string }
    | { command: 'chat/dismissTodos' }
    | { command: 'chat/keepChange'; path?: string }
    | { command: 'chat/undoChange'; path?: string }
    | { command: 'chat/openChangeDiff'; path: string };
