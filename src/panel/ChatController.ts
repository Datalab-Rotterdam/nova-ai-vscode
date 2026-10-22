import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { runAgentLoop, summarize } from '../agent/AgentLoop';
import { BUILT_IN_TOOLS, outputParts, type NovaTool, type ProposedEdit, type ToolPreparation } from '../agent/tools';
import { diffLines } from './diff';
import { createInteractionTools, type InteractionHost } from '../agent/tools/interactionTools';
import { createMemoryTools } from '../agent/tools/memoryTools';
import { displayPath, getScratchRoot, readText, resolveWorkspacePath, workspaceFolders } from '../agent/tools/workspacePaths';
import type { MemoryService } from '../memory/MemoryService';
import { type PermissionService, suggestRule } from '../permissions/PermissionService';
import { getSystemRole } from '../core/apiSupport';
import { COMMAND_SHOW_HELP } from '../core/constants';
import { buildTranscript, estimateMessagesTokens, summaryBlock, tokenCalibration } from '../agent/ContextManager';
import { getCompactThreshold, getMaxToolRounds, isAttachButtonEnabled, isAutoCompactEnabled } from '../core/config';
import { Diagnostics } from '../core/diagnostics';
import { createPanelPrompt } from '../core/prompts';
import type { LanguageModelInfo } from '../core/types';
import { toolResultText } from '../model/messages';
import type { ModelProvider } from '../model/modelProvider';
import { createDirectModel } from './directModel';
import type { ProposedContentProvider } from './ProposedContentProvider';
import type {
    ApprovalDecision,
    ApprovalMode,
    Attachment,
    ChatCommand,
    ChatEvent,
    ChatItem,
    ChatModelOption,
    ChatState,
    FileChange,
    QuestionItem,
    QueuedMessage,
    SessionSummary,
    ToolItem
} from './protocol';
import { enabledSkills, type Skill, type SkillPaths } from '../skills/SkillService';
import { buildSkillsPrompt, createLoadSkillTool } from '../skills/skillTools';
import type { ChatHub } from './ChatHub';
import { parseSlashCommand, type ParsedSlashCommand } from './slashCommands';
import { runIdOf, setRunId, visibleChatItems } from './steps';
import { classifyLink, confirmAndOpenExternal } from './links';
import { confirmAndDeleteChats, type ChatHistory } from './chatSearch';
import { classifyFile } from './drop';
import { fromStoredMessages, type SessionStore, type StoredSession, toStoredMessages } from './SessionStore';

const MAX_ATTACHMENT_CHARS = 60_000;
/** Images the model may see in one run: the newest plus what is already in the conversation. */
const MAX_IMAGES_PER_RUN = 4;
/** Composer images up to this many bytes; larger than about 2.5 MB of base64 over the message port. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIME = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp']
]);
const MAX_CARD_OUTPUT_CHARS = 4_000;
const LAST_SESSION_KEY = 'nova.chat.lastSession';

export interface ChatControllerOptions {
    /** Knows the other open chats; without it this controller is on its own (tests). */
    hub?: ChatHub;
    /** Remember the open chat for the next window (the sidebar); default true. */
    rememberLast?: boolean;
    /** Chat to start with: an id, null for a new chat, undefined for the remembered one. */
    initialSessionId?: string | null;
    /** Shows this chat's surface. */
    reveal?: () => Promise<void> | void;
    /** The chat's title changed (editor tabs show it). */
    onTitle?: (title: string) => void;
}
const MAX_CARD_DIFF_LINES = 400;

interface TrackedChange {
    uri: vscode.Uri;
    path: string;
    baseline: string;
    current: string;
    created: boolean;
}
/** Tools rendered by their own UI instead of a tool card. */
const INTERACTION_TOOLS = new Set(['todo_write', 'ask_user']);

interface PendingApproval {
    resolve(decision: ApprovalDecision): void;
}

interface PendingEdit {
    original: vscode.Uri;
    proposed: vscode.Uri;
    path: string;
}

/**
 * Runs the Nova chat panel: one conversation at a time, Nova's own tools with
 * approvals, persistence through {@link SessionStore}. The webview only renders
 * {@link ChatState} and the incremental {@link ChatEvent}s posted here.
 */
export class ChatController implements vscode.Disposable, ChatHistory {
    private session: StoredSession = newSession();
    private messages: vscode.LanguageModelChatMessage[] = [];
    private attachments: Attachment[] = [];
    private models: LanguageModelInfo[] = [];
    /** Last workspace scan behind the `@` file list, and when it was completed. */
    private fileOptionsCache: string[] = [];
    private fileOptionsAt = 0;
    private fileOptionsStamp = '';
    private fileOptionsScan?: Promise<string[]>;

    /** Re-scan the workspace for `@` suggestions older than this. */
    private static readonly FILE_OPTIONS_STALE_MS = 2_000;
    private running?: vscode.CancellationTokenSource;
    private usage?: { used: number; total: number };
    private sessionApproved = false;
    /** Messages sent while Nova works; see {@link QueuedMessage}. Attachments are kept in full here. */
    private queue: Array<QueuedMessage & { files: Attachment[] }> = [];
    /** Set when the user pressed stop: queued messages then wait instead of running automatically. */
    private stoppedByUser = false;
    /** Conversation of the current run (system prompt first), so steering can record message positions. */
    private conversation?: vscode.LanguageModelChatMessage[];
    /** Resolves when the current run has finished and been saved. */
    private currentRun?: Promise<void>;
    /** Files Nova changed in this chat, with their content before Nova's first edit. */
    private readonly changes = new Map<string, TrackedChange>();
    /** The ask_user question waiting for an answer. */
    private pendingQuestion?: { itemId: string; resolve(answer: string | undefined): void };
    private readonly approvals = new Map<string, PendingApproval>();
    private readonly edits = new Map<string, PendingEdit>();
    private readonly disposables: vscode.Disposable[] = [];
    private initialized?: Promise<void>;
    private rememberLast: boolean;
    /** Name of the model answering the running reply (steering messages get it too). */
    private runModelName?: string;
    /** The session the hub last heard about, so it is only told about changes. */
    private announcedSessionId?: string;
    /** Thinking being streamed now, so its duration can be sealed when it ends. */
    private activeThinking?: Extract<ChatItem, { kind: 'thinking' }>;
    private activeAssistants: Array<Extract<ChatItem, { kind: 'assistant' }>> = [];
    /** The user item the running reply answers, so its steps join that answer's run. */
    private currentRunUser?: Extract<ChatItem, { kind: 'user' }>;
    /**
     * The model conversation (messages) after each answer version finished, so a switched
     * version restores exactly what the model saw. In-memory only: on reload, versions
     * rebuild from the visible chat instead.
     */
    private readonly snapshots = new Map<string, vscode.LanguageModelChatMessage[]>();

    public constructor(
        private readonly modelProvider: ModelProvider,
        private readonly store: SessionStore,
        private readonly workspaceState: vscode.Memento,
        private readonly proposedContent: ProposedContentProvider,
        private readonly diagnostics: Diagnostics,
        private post: (event: ChatEvent) => void,
        private readonly services: { memory?: MemoryService; permissions?: PermissionService; skillPaths?: () => SkillPaths } = {},
        private readonly options: ChatControllerOptions = {}
    ) {
        this.rememberLast = options.rememberLast ?? true;
        this.disposables.push(this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refreshModels().then(() => this.postState())));
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('nova.chat.attachButton')) {
                this.postState();
            }
        }));
        if (options.hub) {
            this.disposables.push(options.hub.onDidChange(() => this.postSessions()));
        }
        if (this.store.onDidChange) {
            this.disposables.push(this.store.onDidChange(() => this.postSessions()));
        }
    }

    public dispose(): void {
        this.running?.cancel();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.options.hub?.remove(this);
    }

    /** Sends this chat's events to another webview (the chat moved to an editor tab) and resyncs it. */
    public moveTo(post: (event: ChatEvent) => void, options: Pick<ChatControllerOptions, 'reveal' | 'onTitle'>): void {
        this.post = post;
        this.rememberLast = false;
        this.options.reveal = options.reveal;
        this.options.onTitle = options.onTitle;
        this.postState();
    }

    /** Shows this chat's surface (the sidebar or its editor tab). */
    public async reveal(): Promise<void> {
        await this.options.reveal?.();
    }

    /** Nothing to keep: no message yet and nothing running. */
    public get isEmpty(): boolean {
        return !this.session.items.length && !this.running;
    }

    public get title(): string {
        return this.session.title;
    }

    public async handle(command: ChatCommand): Promise<void> {
        await this.initialize();
        switch (command.command) {
            case 'chat/ready':
                await this.refreshModels();
                this.postState();
                break;
            case 'chat/send':
                await this.send(command.text);
                break;
            case 'chat/compact':
                await this.compact(command.focus ?? '');
                break;
            case 'chat/stop':
                this.stop();
                break;
            case 'chat/approval':
                this.approvals.get(command.itemId)?.resolve(command.decision);
                break;
            case 'chat/new':
                await this.newChat();
                break;
            case 'chat/open':
                await this.openSession(command.sessionId);
                break;
            case 'chat/rename':
                await this.renameSession(command.sessionId, command.title);
                break;
            case 'chat/delete':
                await confirmAndDeleteChats(this, command.sessionIds);
                break;
            case 'chat/selectModel':
                this.selectModel(command.modelId);
                break;
            case 'chat/addFile':
                await this.addFile();
                break;
            case 'chat/attachFile':
                this.addAttachment({ id: randomUUID(), path: command.path, label: command.path });
                break;
            case 'chat/addSelection':
                await this.addSelection();
                break;
            case 'chat/removeAttachment':
                this.attachments = this.attachments.filter((attachment) => attachment.id !== command.id);
                this.post({ type: 'chat/attachments', attachments: this.attachments });
                break;
            case 'chat/addImage':
                this.addImage(command.name, command.dataUrl);
                break;
            case 'chat/attachUris':
                await this.attachUris(command.uris);
                break;
            case 'chat/addTextFile':
                this.addTextFile(command.name, command.content);
                break;
            case 'chat/openDiff':
                await this.openDiff(command.itemId);
                break;
            case 'chat/openFile':
                await this.openFile(command.path);
                break;
            case 'chat/openLink':
                await this.openLink(command.href, command.text);
                break;
            case 'chat/queueMode':
                this.queue = this.queue.map((item) => (item.id === command.id ? { ...item, mode: command.mode } : item));
                this.postQueue();
                break;
            case 'chat/queueRemove':
                this.queue = this.queue.filter((item) => item.id !== command.id);
                this.postQueue();
                break;
            case 'chat/answer':
                this.answerQuestion(command.itemId, command.answer);
                break;
            case 'chat/skipQuestion':
                this.answerQuestion(command.itemId, undefined);
                break;
            case 'chat/keepChange':
                this.keepChange(command.path);
                break;
            case 'chat/undoChange':
                await this.undoChange(command.path);
                break;
            case 'chat/openChangeDiff':
                await this.openChangeDiff(command.path);
                break;
            case 'chat/dismissTodos':
                this.session.todos = [];
                this.post({ type: 'chat/todos', todos: [] });
                break;
            case 'chat/editMessage':
                if (this.findUser(command.itemId)?.branch) {
                    // Editing an answer version re-runs only that version of the answer.
                    await this.rerunBranch(command.itemId, command.text);
                } else {
                    await this.editMessage(command.itemId, command.text);
                }
                break;
            case 'chat/regenerate':
                await this.regenerate(command.itemId);
                break;
            case 'chat/branch':
                await this.branch(command.itemId, command.mode);
                break;
            case 'chat/queueSendNow':
                await this.sendQueuedNow(command.id);
                break;
            case 'chat/setApprovalMode':
                await vscode.workspace.getConfiguration('nova').update('agent.approvalMode', command.mode, vscode.ConfigurationTarget.Global);
                this.postState();
                break;
        }
    }

    /** Adds the active editor's selection (or whole file) as an attachment. */
    public async addSelection(): Promise<void> {
        await this.initialize();
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            void vscode.window.showInformationMessage('Open a file in the editor to add it to the Nova chat.');
            return;
        }

        const path = displayPath(editor.document.uri);
        const selection = editor.selection;
        const lines: [number, number] | undefined = selection.isEmpty
            ? undefined
            : [selection.start.line + 1, selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line : selection.end.line + 1];
        this.addAttachment({ id: randomUUID(), path, lines, label: lines ? `${path}:${lines[0]}-${lines[1]}` : path });
    }

    /** Adds an image the user pasted or dropped into the composer, sent to Nova as vision input. */
    private addImage(name: string, dataUrl: string): void {
        const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/.exec(dataUrl);
        const mimeType = (name && IMAGE_MIME.get(name.split('.').pop()?.toLowerCase() ?? '')) || match?.[1];
        const source = match ? match[2] : dataUrl;
        if (!mimeType || !mimeType.startsWith('image/') || !source) {
            this.notice('warning', 'Only PNG, JPEG and WebP images can be attached.');
            return;
        }
        if (source.length > (MAX_IMAGE_BYTES * 4) / 3 + 4) {
            this.notice('warning', `${name} is too large to attach (at most ${Math.round(MAX_IMAGE_BYTES / 1024 / 10) / 10} MB).`);
            return;
        }
        this.addAttachment({ id: randomUUID(), label: name || 'image', image: { mimeType, data: source } });
    }

    /** Adds a text file from outside the workspace as inline content, clipped like attached files. */
    private addTextFile(name: string, content: string): void {
        if (classifyFile(name) !== 'text' || content.includes('\u0000')) {
            this.notice('warning', `${name} cannot be attached: only text files and PNG, JPEG or WebP images.`);
            return;
        }
        if (content.length > MAX_ATTACHMENT_CHARS) {
            this.notice('info', `${name} is long; only the first ${MAX_ATTACHMENT_CHARS.toLocaleString()} characters are sent.`);
        }
        this.addAttachment({ id: randomUUID(), label: name, content: content.slice(0, MAX_ATTACHMENT_CHARS) });
    }

    /**
     * Attaches dropped or pasted files. Workspace files attach by path like an `@` mention;
     * images go through {@link addImage}; other files are read and attached as inline text.
     */
    private async attachUris(uris: readonly string[]): Promise<void> {
        for (const value of uris) {
            let uri: vscode.Uri;
            try {
                uri = vscode.Uri.parse(value);
            } catch {
                continue;
            }
            const name = uri.path.split('/').pop() || 'file';
            try {
                const kind = classifyFile(name);
                if (kind === 'unsupported') {
                    this.notice('warning', `${name} cannot be attached: only text files and PNG, JPEG or WebP images.`);
                    continue;
                }
                if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) {
                    this.notice('warning', `${name} is a folder; attach the files in it instead.`);
                    continue;
                }
                if (kind === 'image') {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    this.addImage(name, `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`);
                } else if (vscode.workspace.getWorkspaceFolder(uri)) {
                    const path = displayPath(uri);
                    this.addAttachment({ id: randomUUID(), path, label: path });
                } else {
                    this.addTextFile(name, await readText(uri));
                }
            } catch {
                this.notice('warning', `${name} could not be read.`);
            }
        }
    }

    /**
     * Which attached images the model actually sees. Vision models see all of them, up to
     * {@link MAX_IMAGES_PER_RUN} counting the ones already in the conversation (newest win).
     * Models without vision see the newest image at most: their failures on image payloads
     * are worse than seeing one image. Dropped images stay in the transcript as labels.
     */
    private fitImages(attachments: readonly Attachment[]): Attachment[] {
        const model = this.models.find((candidate) => candidate.id === this.selectedModelId());
        const inConversation = this.messages.reduce((count, message) =>
            count + message.content.filter((part) => part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')).length, 0);
        const imageIndexes = attachments.map((attachment, index) => (attachment.image ? index : -1)).filter((index) => index >= 0);
        let keep: Set<number>;
        if (model?.capabilities?.imageInput !== true) {
            // Without vision, keep the newest image at most.
            const last = imageIndexes.at(-1);
            keep = new Set(last !== undefined && inConversation < MAX_IMAGES_PER_RUN ? [last] : []);
        } else {
            // Keep the newest images that fit next to the ones already in the conversation.
            const budget = Math.max(0, MAX_IMAGES_PER_RUN - inConversation);
            keep = new Set(imageIndexes.slice(imageIndexes.length - budget));
        }
        return attachments.map((attachment, index) =>
            attachment.image && !keep.has(index) ? { ...attachment, image: undefined } : attachment);
    }

    public async newChat(): Promise<void> {
        await this.stopAndWait();
        this.session = newSession();
        this.messages = [];
        this.attachments = [];
        this.usage = undefined;
        this.sessionApproved = false;
        this.edits.clear();
        this.queue = [];
        this.changes.clear();
        this.postState();
    }

    public getState(): ChatState {
        return {
            sessionId: this.session.id,
            title: this.session.title,
            items: this.session.items,
            running: Boolean(this.running),
            models: this.models.map(toModelOption),
            modelId: this.selectedModelId(),
            attachments: this.attachments,
            usage: this.usage,
            sessions: this.store.list(),
            openElsewhere: this.openElsewhere(),
            approvalMode: getApprovalMode(),
            queue: this.queueView(),
            todos: this.session.todos ?? [],
            changes: this.changesView(),
            fileOptions: this.fileOptions(),
            attachButtonEnabled: isAttachButtonEnabled()
        };
    }

    private initialize(): Promise<void> {
        this.initialized ??= (async () => {
            const wanted = this.options.initialSessionId !== undefined
                ? this.options.initialSessionId
                : this.rememberLast ? this.workspaceState.get<string>(LAST_SESSION_KEY) : undefined;
            // A chat open in another tab stays there.
            const last = wanted && !this.options.hub?.ownerOf(wanted, this) ? await this.store.load(wanted) : undefined;
            if (last) {
                this.loadSession(last);
            }
            await this.refreshModels();
        })();
        return this.initialized;
    }

    private async refreshModels(): Promise<void> {
        this.models = await this.modelProvider.listModels();
    }

    /** The session's model, else the provider's default (the first tool-capable model). */
    private selectedModelId(): string | undefined {
        if (this.models.some((model) => model.id === this.session.modelId)) {
            return this.session.modelId;
        }
        return (this.models.find((model) => model.isDefault) ?? this.models[0])?.id;
    }

    private postState(): void {
        this.post({ type: 'chat/state', state: this.getState() });
        this.options.onTitle?.(this.session.title);
        if (this.announcedSessionId !== this.session.id) {
            this.announcedSessionId = this.session.id;
            this.options.hub?.notify();
        }
    }

    /** The chat list and where chats are open changed elsewhere. */
    private postSessions(): void {
        this.post({ type: 'chat/sessions', sessions: this.store.list(), openElsewhere: this.openElsewhere() });
    }

    private openElsewhere(): string[] {
        return this.options.hub?.openElsewhere(this) ?? [];
    }

    /** The sidebar reopens its last chat after a reload; editor tabs remember their own. */
    private async rememberAsLast(): Promise<void> {
        if (this.rememberLast) {
            await this.workspaceState.update(LAST_SESSION_KEY, this.session.id);
        }
    }

    /** The sidebar's chat moved to a tab: after a reload the sidebar starts empty. */
    public async forgetLast(): Promise<void> {
        await this.workspaceState.update(LAST_SESSION_KEY, undefined);
    }

    /**
     * Switches the model for the next messages (earlier replies keep theirs). A smaller
     * context window may no longer hold the conversation: the usage meter shows the new
     * share at once, and the user is told whether the next request compacts it first.
     */
    private selectModel(modelId: string): void {
        const previous = this.models.find((model) => model.id === this.selectedModelId());
        this.session.modelId = modelId;
        const next = this.models.find((model) => model.id === modelId);
        if (!next || !this.messages.length) {
            this.usage = undefined;
            this.postState();
            return;
        }

        const used = estimateMessagesTokens(this.messages, tokenCalibration.ratio(next.id));
        const total = next.maxInputTokens;
        this.usage = { used, total };
        if (previous?.id !== next.id && used > total * getCompactThreshold()) {
            const size = `This chat is about ${formatTokens(used)} tokens; ${next.name} takes ${formatTokens(total)}.`;
            this.addItem(isAutoCompactEnabled()
                ? {
                    kind: 'notice',
                    id: randomUUID(),
                    tone: 'info',
                    text: `${size} Older messages will be summarized before the next request.`
                }
                : {
                    kind: 'notice',
                    id: randomUUID(),
                    tone: 'warning',
                    text: used > total
                        ? `${size} It no longer fits and automatic compaction is off (nova.context.autoCompact): switch back, turn it on, or start a new chat.`
                        : `${size} It is close to the limit and automatic compaction is off (nova.context.autoCompact).`
                });
        }
        this.postState();
    }

    /** Stops the running reply and waits until it has been saved to its own chat. */
    public async stopAndWait(): Promise<void> {
        if (this.running) {
            this.stop();
            await this.currentRun;
        }
    }

    /** Sends a message, or queues it as steering when Nova is already working. Slash commands run here instead. */
    private async send(text: string): Promise<void> {
        const prompt = text.trim();
        if (!prompt && !this.attachments.length) {
            return;
        }

        const slash = parseSlashCommand(prompt);
        if (slash) {
            await this.runSlashCommand(slash);
            return;
        }

        // A pending question is answered by whatever the user types.
        if (this.pendingQuestion && prompt) {
            this.answerQuestion(this.pendingQuestion.itemId, prompt);
            return;
        }

        const attachments = this.attachments;
        this.attachments = [];
        this.post({ type: 'chat/attachments', attachments: [] });

        if (this.running) {
            this.queue.push({
                id: randomUUID(),
                text: prompt,
                attachments: attachments.map((attachment) => attachment.label),
                files: attachments,
                mode: 'steer'
            });
            this.postQueue();
            return;
        }

        await this.run(prompt, attachments);
    }

    private run(prompt: string, attachments: Attachment[], steered = false, owner?: Extract<ChatItem, { kind: 'user' }>): Promise<void> {
        return this.track(this.runInner(prompt, attachments, steered, owner));
    }

    /** Remembers work that {@link stopAndWait} has to wait for. */
    private track(work: Promise<void>): Promise<void> {
        this.currentRun = work;
        return work.finally(() => {
            if (this.currentRun === work) {
                this.currentRun = undefined;
            }
        });
    }

    /** Runs a slash command typed in the composer (see slashCommands.ts). */
    private async runSlashCommand({ command, args }: ParsedSlashCommand): Promise<void> {
        switch (command.name) {
            case 'clear':
                await this.newChat();
                break;
            case 'compact':
                await this.compact(args);
                break;
            case 'model':
                this.switchModel(args);
                break;
            case 'rename':
                if (args) {
                    await this.renameSession(this.session.id, args);
                } else {
                    this.notice('info', 'Give the new name: /rename <title>');
                }
                break;
            case 'help':
                await vscode.commands.executeCommand(COMMAND_SHOW_HELP);
                break;
        }
    }

    /**
     * `/compact`: replaces the conversation the model sees with a summary of it, so later
     * messages start with a nearly empty context. The chat itself stays visible.
     */
    private async compact(focus: string): Promise<void> {
        if (this.running) {
            this.notice('warning', 'Nova is working. Use /compact after the reply, or stop it first.');
            return;
        }
        if (!this.messages.length) {
            this.notice('info', 'Nothing to compact yet.');
            return;
        }
        const info = this.models.find((candidate) => candidate.id === this.selectedModelId());
        const model = info ? createDirectModel(this.modelProvider, info) : undefined;
        if (!model) {
            this.notice('error', 'No Nova model is available. Connect Nova AI or refresh the models.');
            return;
        }
        await this.track(this.compactInner(model, focus));
    }

    private async compactInner(model: vscode.LanguageModelChat, focus: string): Promise<void> {
        this.stoppedByUser = false;
        const running = new vscode.CancellationTokenSource();
        this.running = running;
        this.post({ type: 'chat/running', running: true });

        const ratio = tokenCalibration.ratio(model.id);
        const before = estimateMessagesTokens(this.messages, ratio);
        try {
            const summary = (await summarize(model, buildTranscript(this.messages), model.maxInputTokens, running.token, focus || undefined)).trim();
            if (running.token.isCancellationRequested) {
                this.notice('info', 'Stopped. The conversation was not compacted.');
                return;
            }
            if (!summary) {
                throw new Error('The model returned an empty summary.');
            }
            this.messages = [vscode.LanguageModelChatMessage.User(summaryBlock(summary))];
            this.forgetMessagePositions();
            const after = estimateMessagesTokens(this.messages, ratio);
            this.usage = { used: after, total: model.maxInputTokens };
            this.post({ type: 'chat/usage', usage: this.usage });
            this.notice('info', `Conversation compacted from about ${formatTokens(before)} to ${formatTokens(after)} tokens. Nova continues from a summary; the messages above are kept for you to read.`);
        } catch (error) {
            if (running.token.isCancellationRequested) {
                this.notice('info', 'Stopped. The conversation was not compacted.');
            } else {
                this.diagnostics.error('Compacting the Nova chat failed.', error);
                this.notice('error', `Compacting failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            this.running = undefined;
            running.dispose();
            this.post({ type: 'chat/running', running: false });
            await this.persist();
            this.drainQueue();
        }
    }

    /** `/model`: lists the models, or switches to the one whose name or id matches. */
    private switchModel(query: string): void {
        const current = this.selectedModelId();
        const list = (models: readonly LanguageModelInfo[]) => models.map((model) => `${model.id === current ? '● ' : '○ '}${model.name}`).join('\n');
        if (!query) {
            this.notice('info', this.models.length ? `Models (switch with /model <name>):\n${list(this.models)}` : 'No Nova models are available.');
            return;
        }

        const wanted = query.toLowerCase();
        const exact = this.models.find((model) => model.id.toLowerCase() === wanted || model.name.toLowerCase() === wanted);
        const matches = exact ? [exact] : this.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(wanted));
        if (matches.length !== 1) {
            this.notice('warning', matches.length
                ? `"${query}" matches several models:\n${list(matches)}`
                : `No model matches "${query}". Models:\n${list(this.models)}`);
            return;
        }
        this.notice('info', `Model: ${matches[0].name}`);
        this.selectModel(matches[0].id);
    }

    private notice(tone: Extract<ChatItem, { kind: 'notice' }>['tone'], text: string): void {
        this.addItem({ kind: 'notice', id: randomUUID(), tone, text });
    }

    private async runInner(prompt: string, attachments: Attachment[], steered: boolean, owner?: Extract<ChatItem, { kind: 'user' }>): Promise<void> {
        this.stoppedByUser = false;

        if (!this.models.length) {
            await this.refreshModels();
        }
        const info = this.models.find((candidate) => candidate.id === this.selectedModelId());
        const model = info ? createDirectModel(this.modelProvider, info) : undefined;
        if (!model) {
            this.addItem({ kind: 'notice', id: randomUUID(), text: 'No Nova model is available. Connect Nova AI or refresh the models.', tone: 'error' });
            return;
        }
        this.session.modelId = model.id;
        this.runModelName = info?.name ?? model.name;

        // The answer of this run: a new user item (or the branch item that owns the run,
        // which stays where it is so its version keeps its place in the chat).
        let runUser: Extract<ChatItem, { kind: 'user' }>;
        if (owner) {
            runUser = owner;
        } else {
            runUser = {
                kind: 'user',
                id: randomUUID(),
                text: prompt,
                attachments: attachments.map((attachment) => attachment.label),
                files: attachments,
                messageIndex: this.messages.length,
                model: this.runModelName,
                ...(steered ? { steered } : {})
            };
            this.addItem(runUser);
            if (this.session.items.filter((item) => item.kind === 'user').length === 1) {
                this.session.title = summarizeTitle(prompt || attachments[0]?.label || 'New chat');
                this.options.onTitle?.(this.session.title);
            }
        }
        this.currentRunUser = runUser;

        this.messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(prompt, this.fitImages(attachments))));

        const running = new vscode.CancellationTokenSource();
        this.running = running;
        this.post({ type: 'chat/running', running: true });

        // Only the skills that are on, and their list ranked by this message (see skillTools).
        const skills = this.services.skillPaths ? enabledSkills(this.services.skillPaths()) : [];
        const conversation = [await createSystemMessage(this.services.memory, buildSkillsPrompt(skills, prompt)), ...this.messages];
        this.conversation = conversation;
        const tools = availableTools(this.services.memory, this.interactionHost(), skills);
        let assistantItem: Extract<ChatItem, { kind: 'assistant' }> | undefined;
        let thinkingItem: Extract<ChatItem, { kind: 'thinking' }> | undefined;
        this.activeThinking = undefined;
        this.activeAssistants = [];

        try {
            const result = await runAgentLoop({
                model,
                messages: conversation,
                pinned: 1,
                tools: tools.map((tool) => tool.info),
                invokeTool: (call, token) => this.invokeTool(tools, call, token),
                maxRounds: getMaxToolRounds(),
                autoCompact: isAutoCompactEnabled(),
                compactThreshold: getCompactThreshold(),
                takeSteering: () => this.takeSteering()
            }, {
                text: (delta) => {
                    if (!assistantItem || this.session.items[this.session.items.length - 1] !== assistantItem) {
                        if (assistantItem) {
                            this.sealAssistant(assistantItem);
                        }
                        assistantItem = { kind: 'assistant', id: randomUUID(), text: '', startedAt: Date.now(), runId: runUser.id };
                        this.activeAssistants.push(assistantItem);
                        this.addItem(assistantItem);
                    }
                    assistantItem.text += delta;
                    this.post({ type: 'chat/textDelta', itemId: assistantItem.id, delta });
                },
                thinking: (delta) => {
                    if (!thinkingItem || this.session.items[this.session.items.length - 1] !== thinkingItem) {
                        if (thinkingItem) {
                            this.sealThinking(thinkingItem);
                        }
                        thinkingItem = { kind: 'thinking', id: randomUUID(), text: '', startedAt: Date.now(), runId: runUser.id };
                        this.activeThinking = thinkingItem;
                        this.addItem(thinkingItem);
                    }
                    thinkingItem.text += delta;
                    this.post({ type: 'chat/textDelta', itemId: thinkingItem.id, delta });
                },
                compacted: (stage) => this.forgetMessagePositions() ?? this.addItem({
                    kind: 'notice',
                    id: randomUUID(),
                    tone: 'info',
                    text: stage === 'summarized'
                        ? 'Earlier messages were summarized to fit the context window.'
                        : 'Older tool output was shortened to fit the context window.'
                }),
                usage: (promptTokens) => {
                    this.usage = { used: promptTokens, total: model.maxInputTokens };
                    this.post({ type: 'chat/usage', usage: this.usage });
                }
            }, running.token);

            if (result.hitRoundLimit) {
                this.addItem({
                    kind: 'notice',
                    id: randomUUID(),
                    tone: 'warning',
                    text: `Stopped after ${getMaxToolRounds()} tool rounds. Send "continue" to keep going.`
                });
            }
        } catch (error) {
            if (!running.token.isCancellationRequested) {
                this.diagnostics.error('Nova panel request failed.', error);
                this.addItem({ kind: 'notice', id: randomUUID(), tone: 'error', text: error instanceof Error ? error.message : String(error) });
            }
        } finally {
            this.sealThinking(this.activeThinking);
            this.activeThinking = undefined;
            for (const assistant of this.activeAssistants) {
                this.sealAssistant(assistant);
            }
            this.activeAssistants = [];
            if (running.token.isCancellationRequested) {
                this.addItem({ kind: 'notice', id: randomUUID(), tone: 'info', text: 'Stopped.' });
            }
            // The loop works on its own copy; keep what it sent (including compaction) minus the system prompt.
            this.messages = closeDanglingToolCalls(conversation.slice(1));
            this.snapshots.set(runUser.id, this.messages);
            this.conversation = undefined;
            this.currentRunUser = undefined;
            this.running = undefined;
            running.dispose();
            this.post({ type: 'chat/running', running: false });
            await this.persist();
            this.drainQueue();
        }
    }

    /**
     * Edits an earlier message: drops it and everything after it (in the chat and in the
     * conversation the model sees), then sends the new text with the selected model.
     */
    private async editMessage(itemId: string, text: string): Promise<void> {
        const index = this.session.items.findIndex((item) => item.id === itemId);
        const item = this.session.items[index];
        if (!item || item.kind !== 'user' || (!text.trim() && !item.files?.length)) {
            return;
        }

        if (this.running) {
            this.stop();
            await this.currentRun;
        }
        // Waiting messages belonged to the conversation being replaced.
        this.queue = [];
        this.postQueue();

        const kept = this.session.items.slice(0, index);
        this.messages = truncateConversation(this.messages, item, kept);
        for (const entry of kept) {
            if (entry.kind === 'user') {
                this.snapshots.delete(entry.id);
            }
        }
        this.session.items = kept;
        this.usage = undefined;
        this.postState();

        await this.run(text.trim(), item.files ?? []);
    }

    /** The user item with an ID, or undefined. */
    private findUser(itemId: string): Extract<ChatItem, { kind: 'user' }> | undefined {
        const item = this.session.items.find((candidate) => candidate.id === itemId);
        return item?.kind === 'user' ? item : undefined;
    }

    /** Stops a running reply and waits for its cleanup. */
    private async settleIfRunning(): Promise<void> {
        if (this.running) {
            this.stop();
            await this.currentRun;
        }
        this.queue = [];
        this.postQueue();
    }

    /** Gives the steps of old runs their run's user ID, so versions can hide them (idempotent). */
    private stampRunIds(): void {
        let owner: string | undefined;
        for (const item of this.session.items) {
            if (item.kind === 'user') {
                owner = item.id;
                continue;
            }
            if (owner && !runIdOf(item)) {
                setRunId(item, owner);
            }
        }
    }

    /**
     * The model conversation before the first version of the group with `host` was asked,
     * rebuilt from the visible chat (text and attachments; tool calls are not replayed).
     */
    private async conversationBeforeGroup(host: string): Promise<vscode.LanguageModelChatMessage[]> {
        const items = this.session.items;
        const start = items.findIndex((item) => (item.kind === 'user' ? item.id === host || item.branch?.hostId === host : false));
        const visible = visibleChatItems(items);
        const kept = visible.filter((item) => items.indexOf(item) < start);
        const messages: vscode.LanguageModelChatMessage[] = [];
        for (const item of kept) {
            if (item.kind === 'user' && (item.text || item.files?.length)) {
                messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(item.text, item.files ?? [])));
            } else if (item.kind === 'assistant' && item.text) {
                messages.push(vscode.LanguageModelChatMessage.Assistant(item.text));
            }
        }
        return messages;
    }

    private hostIdOf(target: Extract<ChatItem, { kind: 'user' }>): string {
        return target.branch?.hostId ?? target.id;
    }

    private versionsOf(host: string): Array<Extract<ChatItem, { kind: 'user' }>> {
        return this.session.items.filter((item) =>
            item.kind === 'user' ? item.id === host || item.branch?.hostId === host : false) as Array<Extract<ChatItem, { kind: 'user' }>>;
    }

    /**
     * Marks a version of an answer group the current one; unless `keepAnswer` is off, also
     * restores the model conversation that version left behind (regeneration starts fresh
     * from before the group instead).
     */
    private async activate(target: Extract<ChatItem, { kind: 'user' }>, restoreConversation = true): Promise<void> {
        const host = this.hostIdOf(target);
        if (this.versionsOf(host).some((version) => version.branch)) {
            for (const version of this.versionsOf(host)) {
                version.branch ??= { hostId: host, current: false };
                version.branch.current = version.id === target.id;
            }
        }
        if (restoreConversation) {
            const saved = this.snapshots.get(target.id);
            if (saved) {
                this.messages = [...saved];
            } else {
                // Rebuild: everything before the group, the version's question, its answer text.
                const base = await this.conversationBeforeGroup(host);
                this.messages = [...base, vscode.LanguageModelChatMessage.User(await buildPrompt(target.text, target.files ?? []))];
                for (const item of this.session.items) {
                    if (item.kind === 'assistant' && runIdOf(item) === target.id && item.text) {
                        this.messages.push(vscode.LanguageModelChatMessage.Assistant(item.text));
                    }
                }
            }
            // The model that answered this version.
            if (target.model) {
                const model = this.models.find((candidate) => candidate.id === target.model || candidate.name === target.model);
                if (model && this.session.modelId !== model.id) {
                    this.selectModel(model.id);
                }
            }
        }
        this.usage = undefined;
    }

    private deleteVersion(target: Extract<ChatItem, { kind: 'user' }>): void {
        this.session.items = this.session.items.filter((item) => item.id !== target.id && runIdOf(item) !== target.id);
        this.snapshots.delete(target.id);
    }

    /** Regenerates the answer of a version: a new branch is added next to it and becomes current. */
    private async regenerate(itemId: string): Promise<void> {
        const target = this.findUser(itemId);
        if (!target) {
            return;
        }
        await this.settleIfRunning();
        this.stampRunIds();
        const host = this.hostIdOf(target);

        const branchItem: Extract<ChatItem, { kind: 'user' }> = {
            kind: 'user',
            id: randomUUID(),
            text: target.text,
            attachments: target.attachments,
            files: target.files,
            model: this.runModelName,
            branch: { hostId: host, modelId: this.selectedModelId(), current: true }
        };
        this.session.items.push(branchItem);
        // The previous answer is no longer the context a fresh run should keep.
        await this.activate(branchItem, false);
        this.messages = await this.conversationBeforeGroup(host);
        await this.run(branchItem.text, branchItem.files ?? [], false, branchItem);
    }

    /** Switches, accepts (keeps) or discards (falls back to) an answer version. */
    private async branch(itemId: string, mode: 'switch' | 'accept' | 'discard'): Promise<void> {
        const target = this.findUser(itemId);
        if (!target) {
            return;
        }
        await this.settleIfRunning();
        this.stampRunIds();
        const host = this.hostIdOf(target);

        if (mode === 'discard') {
            if (!target.branch) {
                return;
            }
            const wasCurrent = target.branch.current;
            this.deleteVersion(target);
            if (wasCurrent) {
                // Another version takes over; the oldest remaining one wins.
                const fallback = this.versionsOf(host);
                if (fallback.length) {
                    await this.activate(fallback[0]!);
                } else {
                    this.messages = await this.conversationBeforeGroup(host);
                }
            }
        } else {
            await this.activate(target);
            if (mode === 'accept') {
                // The accepted version becomes canonical; the other versions go away.
                for (const version of this.versionsOf(host)) {
                    if (version.id !== target.id) {
                        this.deleteVersion(version);
                    }
                }
                if (host !== target.id) {
                    // The original question and answer are rolled up into the accepted run.
                    this.session.items = this.session.items.filter((item) => item.id !== host && runIdOf(item) !== host);
                }
                // One version left: the group is a plain question again.
                const kept = this.findUser(target.id);
                if (kept?.branch) {
                    delete kept.branch;
                }
            }
        }
        this.postState();
        await this.persist();
    }

    /** Edits an answer version's message and reruns only that version of the answer. */
    private async rerunBranch(itemId: string, text: string): Promise<void> {
        const target = this.findUser(itemId);
        if (!target || (!text.trim() && !target.files?.length)) {
            return;
        }
        await this.settleIfRunning();
        this.stampRunIds();

        // The version's old steps and answer go: the rerun replaces them in place.
        const host = this.hostIdOf(target);
        this.session.items = this.session.items.filter((item) => item.id === target.id || runIdOf(item) !== target.id);

        target.text = text.trim();
        this.messages = await this.conversationBeforeGroup(host);
        this.snapshots.delete(target.id);
        await this.run(target.text, target.files ?? [], false, target);
    }

    private recordChange(edit: ProposedEdit): void {
        const existing = this.changes.get(edit.path);
        this.changes.set(edit.path, {
            uri: edit.uri,
            path: edit.path,
            // The first edit in this chat defines what Undo goes back to.
            baseline: existing ? existing.baseline : edit.original,
            created: existing ? existing.created : edit.isNewFile,
            current: edit.proposed
        });
        this.postChanges();
    }

    private changesView(): FileChange[] {
        return [...this.changes.values()].map((change) => {
            // Same counting as the inline diff, so the numbers match.
            const { added, removed } = diffLines(change.baseline, change.current, 0);
            return { path: change.path, added, removed, created: change.created };
        });
    }

    private postChanges(): void {
        this.post({ type: 'chat/changes', changes: this.changesView() });
    }

    /** Accepts Nova's changes to one file (or all): they are no longer offered for undo. */
    private keepChange(path?: string): void {
        if (path) {
            this.changes.delete(path);
        } else {
            this.changes.clear();
        }
        this.postChanges();
    }

    /** Restores files to their content before Nova's first edit in this chat (deletes files Nova created). */
    private async undoChange(path?: string): Promise<void> {
        const targets = path ? [this.changes.get(path)].filter((change): change is TrackedChange => Boolean(change)) : [...this.changes.values()];
        if (!targets.length) {
            return;
        }

        const modified: string[] = [];
        for (const change of targets) {
            const now = await readText(change.uri).catch(() => undefined);
            if (now !== undefined && now !== change.current) {
                modified.push(change.path);
            }
        }
        if (modified.length) {
            const choice = await vscode.window.showWarningMessage(
                `${modified.join(', ')} changed after Nova edited ${modified.length === 1 ? 'it' : 'them'}. Undo anyway? Your later changes to ${modified.length === 1 ? 'this file' : 'these files'} are lost.`,
                { modal: true },
                'Undo'
            );
            if (choice !== 'Undo') {
                return;
            }
        }

        for (const change of targets) {
            try {
                if (change.created) {
                    await vscode.workspace.fs.delete(change.uri, { useTrash: true });
                } else {
                    const document = await vscode.workspace.openTextDocument(change.uri);
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(change.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), change.baseline);
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                }
                this.changes.delete(change.path);
            } catch (error) {
                void vscode.window.showErrorMessage(`Could not undo the changes to ${change.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.postChanges();
    }

    /** Diff from the content before Nova's first edit to the file as it is now. */
    private async openChangeDiff(path: string): Promise<void> {
        const change = this.changes.get(path);
        if (!change) {
            return this.openFile(path);
        }
        const baseline = this.proposedContent.register(`baseline-${randomUUID()}`, change.path, change.baseline);
        await vscode.commands.executeCommand('vscode.diff', baseline, change.uri, `${change.path} (changes by Nova)`, { preview: true });
    }

    private interactionHost(): InteractionHost {
        return {
            setTodos: (todos) => {
                this.session.todos = todos;
                this.post({ type: 'chat/todos', todos });
            },
            ask: (question, token) => new Promise((resolve) => {
                const item: QuestionItem = { kind: 'question', id: randomUUID(), status: 'pending', ...question };
                this.addItem(item);
                const subscription = token.onCancellationRequested(() => this.answerQuestion(item.id, undefined));
                this.pendingQuestion = {
                    itemId: item.id,
                    resolve: (answer) => {
                        subscription.dispose();
                        resolve(answer);
                    }
                };
            })
        };
    }

    private answerQuestion(itemId: string, answer: string | undefined): void {
        const pending = this.pendingQuestion;
        const item = this.session.items.find((candidate) => candidate.id === itemId);
        if (!pending || pending.itemId !== itemId || item?.kind !== 'question') {
            return;
        }
        this.pendingQuestion = undefined;
        const text = answer?.trim();
        item.status = text ? 'answered' : 'skipped';
        item.answer = text || undefined;
        this.updateItem(item);
        pending.resolve(text || undefined);
    }

    /** Compaction rewrites the conversation: recorded positions no longer apply, so edits rebuild it instead. */
    private forgetMessagePositions(): undefined {
        for (const item of this.session.items) {
            if (item.kind === 'user') {
                delete item.messageIndex;
            }
        }
        return undefined;
    }

    /** Hands steering messages to the running loop and shows them in the transcript. */
    private async takeSteering(): Promise<vscode.LanguageModelChatMessage[]> {
        const steering = this.queue.filter((item) => item.mode === 'steer');
        if (!steering.length) {
            return [];
        }
        this.queue = this.queue.filter((item) => item.mode !== 'steer');
        this.postQueue();

        const messages: vscode.LanguageModelChatMessage[] = [];
        // The loop appends these to the running conversation (whose first message is the system prompt).
        const offset = (this.conversation?.length ?? 1) - 1;
        for (const item of steering) {
            this.addItem({
                kind: 'user',
                id: randomUUID(),
                text: item.text,
                attachments: item.attachments,
                files: item.files,
                messageIndex: offset + messages.length,
                model: this.runModelName,
                steered: true
            });
            messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(item.text, this.fitImages(item.files))));
        }
        return messages;
    }

    /**
     * After a reply, sends the next waiting message: steering that arrived too late for the
     * finished run goes first, then queued follow-ups. Nothing runs automatically after a stop.
     */
    private drainQueue(): void {
        if (this.running || this.stoppedByUser || !this.queue.length) {
            return;
        }
        const next = this.queue.find((item) => item.mode === 'steer') ?? this.queue[0];
        this.queue = this.queue.filter((item) => item !== next);
        this.postQueue();
        setTimeout(() => void this.run(next.text, next.files, next.mode === 'steer'), 0);
    }

    private async sendQueuedNow(id: string): Promise<void> {
        const item = this.queue.find((candidate) => candidate.id === id);
        if (!item) {
            return;
        }
        this.queue = this.queue.filter((candidate) => candidate !== item);
        this.postQueue();
        if (this.running) {
            // Steer immediately: it is picked up at the next step without stopping.
            this.queue.unshift({ ...item, mode: 'steer' });
            this.postQueue();
            return;
        }
        await this.run(item.text, item.files);
    }

    private queueView(): QueuedMessage[] {
        return this.queue.map(({ files: _files, ...item }) => item);
    }

    private postQueue(): void {
        this.post({ type: 'chat/queue', queue: this.queueView() });
    }

    private stop(): void {
        if (this.running) {
            this.stoppedByUser = true;
        }
        this.running?.cancel();
        for (const approval of this.approvals.values()) {
            approval.resolve('reject');
        }
    }

    private async invokeTool(
        tools: readonly AvailableTool[],
        call: vscode.LanguageModelToolCallPart,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const tool = tools.find((candidate) => candidate.info.name === call.name);
        const item: ToolItem = {
            kind: 'tool',
            id: randomUUID(),
            callId: call.callId,
            name: call.name,
            title: call.name,
            input: JSON.stringify(call.input, null, 2),
            status: 'running',
            runId: this.currentRunUser?.id
        };
        // The task list and questions have their own UI; no tool card for them.
        const silent = INTERACTION_TOOLS.has(call.name);
        const addItem = silent ? () => undefined : (value: ChatItem) => this.addItem(value);
        const updateItem = silent ? () => undefined : (value: ChatItem) => this.updateItem(value);
        addItem(item);

        try {
            if (!tool) {
                throw new Error(`Unknown tool "${call.name}". Use one of: ${tools.map((candidate) => candidate.info.name).join(', ')}.`);
            }

            const input = call.input as Record<string, unknown>;
            const preparation: ToolPreparation = tool.nova
                ? await tool.nova.prepare(input as never, { token })
                : { title: call.name };
            item.title = preparation.title;
            item.detail = preparation.detail;
            if (preparation.edit) {
                item.editPath = preparation.edit.path;
                this.registerDiff(item.id, preparation);
            }

            // Rules from .nova-ai settings first: deny always wins, allow skips the approval card.
            const rule = await this.services.permissions?.decide(call.name, input);
            if (rule === 'deny') {
                item.status = 'rejected';
                item.output = 'Blocked by a deny rule in the .nova-ai settings.';
                updateItem(item);
                return textResult('This tool call is blocked by a deny rule in the user\'s .nova-ai settings. Do not retry it; use another approach or ask the user.');
            }

            if (rule !== 'allow' && this.needsApproval(tool)) {
                item.status = 'awaiting-approval';
                if (this.services.permissions) {
                    item.allowRule = suggestRule(call.name, input, workspaceFolders()[0]?.uri.fsPath);
                }
                updateItem(item);
                const decision = await this.waitForApproval(item.id, token);
                if (decision === 'reject') {
                    item.status = 'rejected';
                    updateItem(item);
                    return textResult('The user rejected this tool call. Do not retry it unchanged; ask or try another approach.');
                }
                if (decision === 'approveSession') {
                    this.sessionApproved = true;
                }
                if (decision === 'approveAlways' && item.allowRule && this.services.permissions) {
                    await this.services.permissions.allow(item.allowRule);
                }
            }

            item.status = 'running';
            updateItem(item);

            // Images (a screenshot, an image read with read_file) stay in the result, so a model
            // that reads images gets them; the card shows the text.
            const content = tool.nova
                ? outputParts(await tool.nova.invoke(input as never, { token }, preparation))
                : (await vscode.lm.invokeTool(call.name, { input, toolInvocationToken: undefined }, token)).content;
            const output = toolResultText(content);

            item.status = 'done';
            item.output = clip(output);
            if (preparation.edit && call.name !== 'memory_write') {
                item.diff = diffLines(preparation.edit.original, preparation.edit.proposed, MAX_CARD_DIFF_LINES);
                this.recordChange(preparation.edit);
            }
            updateItem(item);
            return new vscode.LanguageModelToolResult(content);
        } catch (error) {
            item.status = 'error';
            item.output = error instanceof Error ? error.message : String(error);
            updateItem(item);
            throw error;
        }
    }

    private needsApproval(tool: AvailableTool): boolean {
        if (this.sessionApproved) {
            return false;
        }
        switch (getApprovalMode()) {
            case 'autoAll':
                return false;
            case 'autoReadOnly':
                return !tool.readOnly;
            default:
                return true;
        }
    }

    private waitForApproval(itemId: string, token: vscode.CancellationToken): Promise<ApprovalDecision> {
        return new Promise((resolve) => {
            const subscription = token.onCancellationRequested(() => finish('reject'));
            const finish = (decision: ApprovalDecision) => {
                subscription.dispose();
                this.approvals.delete(itemId);
                resolve(decision);
            };
            this.approvals.set(itemId, { resolve: finish });
        });
    }

    private registerDiff(itemId: string, preparation: ToolPreparation): void {
        const edit = preparation.edit!;
        this.edits.set(itemId, {
            path: edit.path,
            // A snapshot, not the live file: once the edit is applied the file already equals the proposal.
            original: this.proposedContent.register(`${itemId}-original`, edit.path, edit.original),
            proposed: this.proposedContent.register(itemId, edit.path, edit.proposed)
        });
    }

    private async openDiff(itemId: string): Promise<void> {
        const edit = this.edits.get(itemId);
        if (!edit) {
            const item = this.session.items.find((candidate) => candidate.id === itemId);
            if (item?.kind === 'tool' && item.editPath) {
                await this.openFile(item.editPath);
            }
            return;
        }
        const item = this.session.items.find((candidate) => candidate.id === itemId);
        const applied = item?.kind === 'tool' && item.status === 'done';
        await vscode.commands.executeCommand('vscode.diff', edit.original, edit.proposed, `${edit.path} (${applied ? 'edit by Nova' : 'Nova proposal'})`, { preview: true });
    }

    /** Links in replies: web links open in the browser after the user sees where they go, paths open in the workspace. */
    private async openLink(href: string, text: string): Promise<void> {
        const link = classifyLink(href);
        if (link.kind === 'external') {
            await confirmAndOpenExternal(link.url, text);
        } else if (link.kind === 'file') {
            await this.openFile(link.path, link.line);
        } else {
            void vscode.window.showWarningMessage(link.reason);
        }
    }

    private async openFile(path: string, line?: number): Promise<void> {
        try {
            const memoryFile = /^(Global|Project) memory/.exec(path);
            const uri = memoryFile && this.services.memory
                ? vscode.Uri.file(this.services.memory.file(memoryFile[1] === 'Global' ? 'global' : 'project'))
                : resolveWorkspacePath(path);
            const position = line ? new vscode.Position(line - 1, 0) : undefined;
            await vscode.window.showTextDocument(uri, { preview: true, selection: position && new vscode.Range(position, position) });
        } catch (error) {
            void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /** Picks files from the workspace and attaches them. */
    private async addFile(): Promise<void> {
        await this.fileOptionsScan;
        const picked = await vscode.window.showQuickPick(
            this.fileOptions().map((label) => ({ label })),
            { placeHolder: 'Add a file to the Nova chat (or type @ in the message)', canPickMany: true, matchOnDescription: true }
        );
        for (const { label } of picked ?? []) {
            this.addAttachment({ id: randomUUID(), path: label, label });
        }
    }

    /** Subfolders never mentioned in `@` (e.g. out/) get no suggestions. */
    private static readonly FILE_EXCLUDE = '**/node_modules/**,**/.git/**,**/dist/**,**/out/**';

    /**
     * The workspace files the composer's `@` list offers, newest-first. Synchronous: it
     * returns the last scan and, when it is stale (folders changed, or files were created
     * or edited since), starts a background re-scan that pushes the refreshed list.
     */
    private fileOptions(): string[] {
        const folders = workspaceFolders();
        if (!folders.length) {
            return ['scratch'];
        }
        const stamp = folders.map((folder) => folder.uri.toString()).join('\0');
        const stale = this.fileOptionsStamp !== stamp || Date.now() - this.fileOptionsAt > ChatController.FILE_OPTIONS_STALE_MS;
        if (stale) {
            // Claim the scan now, so stale callers during it do not start second scans.
            this.fileOptionsStamp = stamp;
            this.refreshFileOptions(folders);
        }
        return this.fileOptionsCache;
    }

    private refreshFileOptions(folders: readonly vscode.WorkspaceFolder[]): void {
        if (this.fileOptionsScan) {
            return;
        }
        const work = this.scanFileOptions(folders)
            .then((options) => {
                this.fileOptionsCache = options;
                this.fileOptionsAt = Date.now();
                this.postState();
                return options;
            })
            .catch(() => [])
            .finally(() => {
                this.fileOptionsScan = undefined;
            });
        this.fileOptionsScan = work;
    }

    private async scanFileOptions(folders: readonly vscode.WorkspaceFolder[]): Promise<string[]> {
        const roots = await Promise.all(folders.map((folder) =>
            vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), ChatController.FILE_EXCLUDE, 5_000)
        ));
        const uris = roots.flat();
        const withMtimes = await Promise.all(uris.map(async (uri) => {
            try {
                return { uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime };
            } catch {
                return { uri, mtime: 0 };
            }
        }));
        // Newest first only orders the empty-query list; every file stays offerable, so
        // `@<typeahead>` finds sources that have not been touched in a while.
        return withMtimes
            .sort((a, b) => b.mtime - a.mtime || a.uri.fsPath.localeCompare(b.uri.fsPath))
            .map(({ uri }) => displayPath(uri));
    }

    private addAttachment(attachment: Attachment): void {
        if (!this.attachments.some((existing) => existing.label === attachment.label)) {
            this.attachments = [...this.attachments, attachment];
        }
        this.post({ type: 'chat/attachments', attachments: this.attachments });
    }

    /** Saved chats of this workspace, newest first. */
    public listSessions(): SessionSummary[] {
        return this.store.list();
    }

    /** The chat shown in the panel; it is only in {@link listSessions} once it has been saved. */
    public get currentSessionId(): string {
        return this.session.id;
    }

    public get isRunning(): boolean {
        return Boolean(this.running);
    }

    /** Shows a saved chat in the panel. Refused while Nova is working, so no reply is cut off. */
    public async openSession(sessionId: string): Promise<boolean> {
        await this.initialize();
        if (sessionId === this.session.id) {
            return true;
        }
        const owner = this.options.hub?.ownerOf(sessionId, this);
        if (owner) {
            await owner.reveal();
            return false;
        }
        if (this.running) {
            void vscode.window.showInformationMessage('Nova is still working in this chat. Stop it first, then open another chat.');
            return false;
        }
        const session = await this.store.load(sessionId);
        if (!session) {
            void vscode.window.showWarningMessage('This Nova chat could not be loaded.');
            return false;
        }
        this.loadSession(session);
        await this.rememberAsLast();
        this.postState();
        return true;
    }

    /** Renames a chat; the open chat is renamed in memory too, so a running reply keeps the name. */
    public async renameSession(sessionId: string, title: string): Promise<void> {
        await this.initialize();
        const name = title.trim();
        if (!name || name.length > 200) {
            return;
        }
        const owner = this.options.hub?.ownerOf(sessionId, this);
        if (owner) {
            await owner.renameSession(sessionId, name);
            return;
        }
        if (sessionId === this.session.id) {
            this.session.title = name;
            // A running reply saves the chat (with the new name) when it ends.
            if (!this.running && this.store.list().some((summary) => summary.id === sessionId)) {
                await this.store.save(this.session);
            }
        } else {
            await this.store.rename(sessionId, name);
        }
        this.postState();
    }

    /**
     * Deletes chats; where one of them is open (here or in another tab) Nova's reply is
     * stopped and that place starts a new chat.
     */
    public async deleteSessions(sessionIds: readonly string[]): Promise<void> {
        await this.initialize();
        const ids = new Set(sessionIds);
        const holders = [this, ...[...ids].flatMap((id) => this.options.hub?.ownerOf(id, this) ?? [])]
            .filter((controller) => ids.has(controller.currentSessionId));
        // Let stopped replies finish saving first, or they would recreate the chats.
        for (const holder of holders) {
            await holder.stopAndWait();
        }
        for (const id of ids) {
            await this.store.delete(id);
        }
        for (const holder of holders) {
            await holder.newChat();
        }
        if (!holders.includes(this)) {
            this.postState();
        }
    }

    private loadSession(session: StoredSession): void {
        this.session = {
            ...session,
            // Approvals and runs do not survive a reload.
            items: session.items.map((item) => item.kind === 'tool' && (item.status === 'awaiting-approval' || item.status === 'running')
                ? { ...item, status: 'rejected' }
                : item.kind === 'question' && item.status === 'pending' ? { ...item, status: 'skipped' } : item)
        };
        this.messages = fromStoredMessages(session.messages);
        this.attachments = [];
        this.usage = undefined;
        this.sessionApproved = false;
        this.edits.clear();
        this.changes.clear();
        this.snapshots.clear();
    }

    private async persist(): Promise<void> {
        this.session.updatedAt = Date.now();
        this.session.messages = toStoredMessages(this.messages);
        try {
            await this.store.save(this.session);
            await this.rememberAsLast();
            this.postState();
        } catch (error) {
            this.diagnostics.error('Saving the Nova chat failed.', error);
        }
    }

    /** Shows a reply without asking the model (development host test command). */
    public addAssistantMessage(text: string): void {
        this.addItem({ kind: 'assistant', id: randomUUID(), text });
    }

    private addItem(item: ChatItem): void {
        this.session.items.push(item);
        this.post({ type: 'chat/itemAdded', item });
    }

    private updateItem(item: ChatItem): void {
        this.post({ type: 'chat/itemUpdated', item: { ...item } });
    }

    /** Records how long a thinking step took, when it ends (or the run stops). */
    private sealThinking(item: Extract<ChatItem, { kind: 'thinking' }> | undefined): void {
        if (item && item.startedAt !== undefined && item.durationMs === undefined) {
            this.updateItem({ ...item, durationMs: Date.now() - item.startedAt });
        }
    }

    /** Records how long an answer took, so its edge case (a bare answer) can say so. */
    private sealAssistant(item: Extract<ChatItem, { kind: 'assistant' }>): void {
        if (item.durationMs === undefined) {
            this.updateItem({ ...item, durationMs: Date.now() - (item.startedAt ?? Date.now()) });
        }
    }
}

interface AvailableTool {
    info: vscode.LanguageModelToolInformation;
    readOnly: boolean;
    /** Built-in tool; undefined for tools from other extensions (MCP). */
    nova?: NovaTool<never>;
}

/** Nova's built-in tools plus MCP tools registered in VS Code, which can run without a chat request. */
function availableTools(memory?: MemoryService, interaction?: InteractionHost, skills: readonly Skill[] = []): AvailableTool[] {
    const webSearchEnabled = vscode.workspace.getConfiguration('nova.webSearch').get<boolean>('enabled', true);
    const novaTools = [
        ...BUILT_IN_TOOLS.filter((tool) => tool.name !== 'web_search' || webSearchEnabled),
        ...(skills.length ? [createLoadSkillTool(skills) as NovaTool<never>] : []),
        ...(interaction ? createInteractionTools(interaction) : []),
        ...(memory?.isEnabled() ? createMemoryTools(memory) : [])
    ];
    const builtIn = novaTools.map((tool) => ({
        info: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, tags: [] } as vscode.LanguageModelToolInformation,
        readOnly: tool.readOnly,
        nova: tool
    }));

    const includeMcp = vscode.workspace.getConfiguration('nova').get<boolean>('agent.includeMcpTools', true);
    const mcp = includeMcp
        ? vscode.lm.tools.filter((tool) => tool.name.startsWith('mcp_')).map((info) => ({ info, readOnly: false }))
        : [];
    return [...builtIn, ...mcp];
}

function toModelOption(model: LanguageModelInfo): ChatModelOption {
    return { id: model.id, name: model.name, maxInputTokens: model.maxInputTokens };
}

function getApprovalMode(): ApprovalMode {
    const mode = vscode.workspace.getConfiguration('nova').get<string>('agent.approvalMode', 'autoReadOnly');
    return mode === 'ask' || mode === 'autoAll' ? mode : 'autoReadOnly';
}

/** The call's subject for permission rules: the command, URL or path it acts on. */
async function createSystemMessage(memory?: MemoryService, skills?: string): Promise<vscode.LanguageModelChatMessage> {
    const prompt = createPanelPrompt({
        folders: workspaceFolders().map((folder) => folder.name),
        platform: process.platform,
        shell: vscode.env.shell || undefined,
        scratch: Boolean(getScratchRoot()),
        memory: memory?.isEnabled() ? await memory.promptSection().catch(() => '') : undefined,
        skills
    });
    const systemRole = getSystemRole();
    return systemRole !== undefined
        ? new vscode.LanguageModelChatMessage(systemRole, prompt)
        : vscode.LanguageModelChatMessage.User(prompt);
}

async function buildPrompt(prompt: string, attachments: readonly Attachment[]): Promise<Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart>> {
    const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];
    const blocks: string[] = [];
    for (const attachment of attachments) {
        if (attachment.image) {
            const data = Uint8Array.from(atob(attachment.image.data), (character) => character.charCodeAt(0));
            parts.push(new vscode.LanguageModelDataPart(data, attachment.image.mimeType));
            continue;
        }
        if (attachment.content !== undefined) {
            blocks.push(`<attachment path="${attachment.label}">\n${attachment.content}\n</attachment>`);
            continue;
        }
        if (!attachment.path) {
            continue;
        }
        try {
            const text = await readText(resolveWorkspacePath(attachment.path));
            const content = attachment.lines
                ? text.split(/\r?\n/).slice(attachment.lines[0] - 1, attachment.lines[1]).join('\n')
                : text;
            const clipped = content.length > MAX_ATTACHMENT_CHARS ? `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n[… truncated …]` : content;
            blocks.push(`<attachment path="${attachment.label}">\n${clipped}\n</attachment>`);
        } catch {
            blocks.push(`<attachment path="${attachment.label}" error="could not be read" />`);
        }
    }
    if (blocks.length) {
        parts.push(new vscode.LanguageModelTextPart(`<attachments>\n${blocks.join('\n\n')}\n</attachments>\n\n`));
    }
    parts.push(new vscode.LanguageModelTextPart(prompt));
    return parts;
}

/**
 * The conversation up to (not including) an edited message. Uses the position recorded when
 * the message was sent; when compaction has changed the conversation since, it is rebuilt
 * from the visible chat instead (user and assistant text).
 */
export function truncateConversation(
    messages: vscode.LanguageModelChatMessage[],
    edited: Extract<ChatItem, { kind: 'user' }>,
    keptItems: readonly ChatItem[]
): vscode.LanguageModelChatMessage[] {
    const index = edited.messageIndex;
    const candidate = index !== undefined ? messages[index] : undefined;
    const matches = candidate?.role === vscode.LanguageModelChatMessageRole.User
        && candidate.content.some((part) => part instanceof vscode.LanguageModelTextPart && part.value.includes(edited.text));
    if (matches && index !== undefined) {
        return messages.slice(0, index);
    }

    return keptItems.flatMap((item) => {
        if (item.kind === 'user' && item.text) {
            return [vscode.LanguageModelChatMessage.User(item.text)];
        }
        if (item.kind === 'assistant' && item.text) {
            return [vscode.LanguageModelChatMessage.Assistant(item.text)];
        }
        return [];
    });
}

/**
 * A stop can leave an assistant tool call without results; add placeholder results
 * so the next request is valid.
 */
export function closeDanglingToolCalls(messages: vscode.LanguageModelChatMessage[]): vscode.LanguageModelChatMessage[] {
    const last = messages[messages.length - 1];
    const calls = last?.role === vscode.LanguageModelChatMessageRole.Assistant
        ? last.content.filter((part): part is vscode.LanguageModelToolCallPart => part instanceof vscode.LanguageModelToolCallPart)
        : [];
    if (!calls.length) {
        return messages;
    }
    return [...messages, vscode.LanguageModelChatMessage.User(calls.map((call) =>
        new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('Cancelled by the user.')])))];
}

function textResult(text: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function clip(text: string): string {
    return text.length > MAX_CARD_OUTPUT_CHARS ? `${text.slice(0, MAX_CARD_OUTPUT_CHARS)}\n…` : text;
}

/** "950", "12.3k", "128k". */
function formatTokens(tokens: number): string {
    if (tokens < 1_000) {
        return String(tokens);
    }
    const thousands = tokens / 1_000;
    return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)}k`;
}

function summarizeTitle(text: string): string {
    const line = text.split('\n')[0].trim();
    return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function newSession(): StoredSession {
    const now = Date.now();
    return { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, items: [], messages: [] };
}
