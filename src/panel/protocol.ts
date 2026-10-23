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
        /** Name of the model that answered this message (older chats do not have it). */
        model?: string;
        /**
         * A regenerated answer, as its own branch next to the user message it replaces.
         * `current` marks the branch the conversation is following; more branches can be
         * added and the answers switch until one is accepted or discarded.
         */
        branch?: { hostId: string; modelId?: string; current: boolean };
    }
    | { kind: 'assistant'; id: string; text: string; startedAt?: number; durationMs?: number; runId?: string }
    | { kind: 'thinking'; id: string; text: string; startedAt?: number; durationMs?: number; runId?: string }
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
    /** The user message this step of an answer belongs to, for answer versions. */
    runId?: string;
    /** The sub-agent that made this call; such steps show inside the agent, not in the chat flow. */
    agentId?: string;
}

/** A research agent started with the spawn_agents tool. */
export interface SubagentState {
    id: string;
    name: string;
    /** The brief the agent got. */
    task: string;
    status: 'queued' | 'running' | 'waiting-approval' | 'done' | 'error' | 'stopped';
    /** Name of the model the agent runs on. */
    model: string;
    /** Title of the tool it is using now. */
    currentTool?: string;
    toolCount: number;
    rounds: number;
    tokens: number;
    startedAt?: number;
    endedAt?: number;
    /** The agent's final report (or the error). */
    report?: string;
    /** The spawn_agents call that started it. */
    callId: string;
    /** The user message whose answer it belongs to. */
    runId?: string;
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
    /** Workspace-relative path, for file and selection attachments. */
    path?: string;
    /** 1-based inclusive line range for selections. */
    lines?: [number, number];
    /** Text of a file dropped from outside the workspace, sent as is instead of read from `path`. */
    content?: string;
    /** A file that is not text or an image (PDF, spreadsheet, …): never inlined, Nova opens it with its tools. `path` is workspace-relative or `scratch/…`. */
    binary?: { size: number };
    /** An image attached from the composer: base64 while it is in the message. */
    image?: { mimeType: string; data: string };
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
    /** Saved chats of the workspace, newest first (for the Chats page). */
    sessions: SessionSummary[];
    /** Chats open in another place (the sidebar or another editor tab). */
    openElsewhere: string[];
    approvalMode: ApprovalMode;
    /** The agent (mode) of this chat and the ones to choose from. */
    agent: string;
    agents: AgentOption[];
    queue: QueuedMessage[];
    /** Nova's task list for the current work; empty when there is none or it was closed. */
    todos: TodoItem[];
    /** Files Nova changed that are waiting for Keep or Undo. */
    changes: FileChange[];
    /** Sub-agents started in this chat. */
    subagents: SubagentState[];
    /** Workspace files offered by `@` in the composer, newest-touched first. */
    fileOptions: string[];
}

export type ApprovalMode = 'ask' | 'autoReadOnly' | 'autoAll';

export interface AgentOption {
    id: string;
    name: string;
    description: string;
    /** Codicon name. */
    icon: string;
    source: 'builtin' | 'global' | 'project';
}

export type ApprovalDecision = 'approve' | 'approveSession' | 'approveAlways' | 'reject';

/** Extension → webview. */
export type ChatEvent =
    | { type: 'chat/state'; state: ChatState }
    | { type: 'chat/sessions'; sessions: SessionSummary[]; openElsewhere: string[] }
    | { type: 'chat/itemAdded'; item: ChatItem }
    | { type: 'chat/itemUpdated'; item: ChatItem }
    | { type: 'chat/textDelta'; itemId: string; delta: string }
    | { type: 'chat/running'; running: boolean }
    | { type: 'chat/usage'; usage: { used: number; total: number } }
    | { type: 'chat/attachments'; attachments: Attachment[] }
    | { type: 'chat/queue'; queue: QueuedMessage[] }
    | { type: 'chat/todos'; todos: TodoItem[] }
    | { type: 'chat/changes'; changes: FileChange[] }
    | { type: 'chat/subagents'; subagents: SubagentState[] };

/** Webview → extension. */
export type ChatCommand =
    | { command: 'chat/ready' }
    | { command: 'chat/send'; text: string }
    | { command: 'chat/stop' }
    | { command: 'chat/approval'; itemId: string; decision: ApprovalDecision }
    | { command: 'chat/new' }
    | { command: 'chat/open'; sessionId: string }
    | { command: 'chat/rename'; sessionId: string; title: string }
    | { command: 'chat/delete'; sessionIds: string[] }
    | { command: 'chat/selectModel'; modelId: string }
    | { command: 'chat/addFile' }
    /** Attaches a file from the composer's `@` list. */
    | { command: 'chat/attachFile'; path: string }
    | { command: 'chat/addSelection' }
    | { command: 'chat/addImage'; name: string; dataUrl: string }
    /** Files dropped or pasted as `file:` URIs (from the Explorer, an editor tab or the OS). */
    | { command: 'chat/attachUris'; uris: string[] }
    /** A text file dropped or pasted from outside VS Code, read by the webview. */
    | { command: 'chat/addTextFile'; name: string; content: string }
    /** Any other file dropped or pasted from outside VS Code, as a data URL. */
    | { command: 'chat/addBinaryFile'; name: string; dataUrl: string }
    | { command: 'chat/removeAttachment'; id: string }
    | { command: 'chat/openDiff'; itemId: string }
    | { command: 'chat/openFile'; path: string }
    | { command: 'chat/openLink'; href: string; text: string }
    /** A code block of an answer, opened as an untitled file in an editor. */
    | { command: 'chat/openSnippet'; code: string; language: string }
    /** A table of an answer, saved as a CSV or Excel file (the extension asks where). */
    | { command: 'chat/exportTable'; format: 'csv' | 'xlsx'; rows: string[][] }
    | { command: 'chat/setApprovalMode'; mode: ApprovalMode }
    | { command: 'chat/setAgent'; id: string }
    /** Opens the Agents page. */
    | { command: 'chat/manageAgents' }
    | { command: 'chat/queueMode'; id: string; mode: QueuedMessage['mode'] }
    | { command: 'chat/queueRemove'; id: string }
    | { command: 'chat/queueSendNow'; id: string }
    | { command: 'chat/editMessage'; itemId: string; text: string }
    /** Regenerates the answer: the run after `itemId` becomes a kept branch next to it. */
    | { command: 'chat/regenerate'; itemId: string }
    /** Force-compacts the conversation the model sees into a summary. */
    | { command: 'chat/compact'; focus?: string }
    /** Switches, accepts (keeps) or discards (falls back to) an answer version. */
    | { command: 'chat/branch'; itemId: string; mode: 'switch' | 'accept' | 'discard' }
    | { command: 'chat/answer'; itemId: string; answer: string }
    | { command: 'chat/skipQuestion'; itemId: string }
    | { command: 'chat/dismissTodos' }
    | { command: 'chat/stopAgent'; id: string }
    | { command: 'chat/keepChange'; path?: string }
    | { command: 'chat/undoChange'; path?: string }
    | { command: 'chat/openChangeDiff'; path: string };
