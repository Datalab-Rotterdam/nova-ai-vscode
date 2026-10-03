import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { runAgentLoop } from '../agent/AgentLoop';
import { BUILT_IN_TOOLS, type NovaTool, type ProposedEdit, type ToolPreparation } from '../agent/tools';
import { diffLines } from './diff';
import { createInteractionTools, type InteractionHost } from '../agent/tools/interactionTools';
import { createMemoryTools } from '../agent/tools/memoryTools';
import { displayPath, getScratchRoot, readText, resolveWorkspacePath, workspaceFolders } from '../agent/tools/workspacePaths';
import type { MemoryService } from '../memory/MemoryService';
import { type PermissionService, suggestRule } from '../permissions/PermissionService';
import { getSystemRole } from '../core/apiSupport';
import { getCompactThreshold, getMaxToolRounds, isAutoCompactEnabled } from '../core/config';
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
    ToolItem
} from './protocol';
import { fromStoredMessages, type SessionStore, type StoredSession, toStoredMessages } from './SessionStore';

const MAX_ATTACHMENT_CHARS = 60_000;
const MAX_CARD_OUTPUT_CHARS = 4_000;
const LAST_SESSION_KEY = 'nova.chat.lastSession';
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
export class ChatController implements vscode.Disposable {
    private session: StoredSession = newSession();
    private messages: vscode.LanguageModelChatMessage[] = [];
    private attachments: Attachment[] = [];
    private models: LanguageModelInfo[] = [];
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

    public constructor(
        private readonly modelProvider: ModelProvider,
        private readonly store: SessionStore,
        private readonly workspaceState: vscode.Memento,
        private readonly proposedContent: ProposedContentProvider,
        private readonly diagnostics: Diagnostics,
        private readonly post: (event: ChatEvent) => void,
        private readonly services: { memory?: MemoryService; permissions?: PermissionService } = {}
    ) {
        this.disposables.push(this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refreshModels().then(() => this.postState())));
    }

    public dispose(): void {
        this.running?.cancel();
        this.disposables.forEach((disposable) => disposable.dispose());
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
                await this.open(command.sessionId);
                break;
            case 'chat/delete':
                await this.deleteSession(command.sessionId);
                break;
            case 'chat/selectModel':
                this.session.modelId = command.modelId;
                this.usage = undefined;
                this.postState();
                break;
            case 'chat/addFile':
                await this.addFile();
                break;
            case 'chat/addSelection':
                await this.addSelection();
                break;
            case 'chat/removeAttachment':
                this.attachments = this.attachments.filter((attachment) => attachment.id !== command.id);
                this.post({ type: 'chat/attachments', attachments: this.attachments });
                break;
            case 'chat/openDiff':
                await this.openDiff(command.itemId);
                break;
            case 'chat/openFile':
                await this.openFile(command.path);
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
                await this.editMessage(command.itemId, command.text);
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

    public async newChat(): Promise<void> {
        this.stop();
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
            approvalMode: getApprovalMode(),
            queue: this.queueView(),
            todos: this.session.todos ?? [],
            changes: this.changesView()
        };
    }

    private initialize(): Promise<void> {
        this.initialized ??= (async () => {
            const lastId = this.workspaceState.get<string>(LAST_SESSION_KEY);
            const last = lastId ? await this.store.load(lastId) : undefined;
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
    }

    /** Sends a message, or queues it as steering when Nova is already working. */
    private async send(text: string): Promise<void> {
        const prompt = text.trim();
        if (!prompt && !this.attachments.length) {
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

    private run(prompt: string, attachments: Attachment[], steered = false): Promise<void> {
        const run = this.runInner(prompt, attachments, steered);
        this.currentRun = run;
        return run.finally(() => {
            if (this.currentRun === run) {
                this.currentRun = undefined;
            }
        });
    }

    private async runInner(prompt: string, attachments: Attachment[], steered: boolean): Promise<void> {
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

        this.addItem({
            kind: 'user',
            id: randomUUID(),
            text: prompt,
            attachments: attachments.map((attachment) => attachment.label),
            files: attachments,
            messageIndex: this.messages.length,
            ...(steered ? { steered } : {})
        });
        if (this.session.items.filter((item) => item.kind === 'user').length === 1) {
            this.session.title = summarizeTitle(prompt || attachments[0]?.label || 'New chat');
        }

        this.messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(prompt, attachments)));

        const running = new vscode.CancellationTokenSource();
        this.running = running;
        this.post({ type: 'chat/running', running: true });

        const conversation = [await createSystemMessage(this.services.memory), ...this.messages];
        this.conversation = conversation;
        const tools = availableTools(this.services.memory, this.interactionHost());
        let assistantItem: Extract<ChatItem, { kind: 'assistant' }> | undefined;
        let thinkingItem: Extract<ChatItem, { kind: 'thinking' }> | undefined;

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
                        assistantItem = { kind: 'assistant', id: randomUUID(), text: '' };
                        this.addItem(assistantItem);
                    }
                    assistantItem.text += delta;
                    this.post({ type: 'chat/textDelta', itemId: assistantItem.id, delta });
                },
                thinking: (delta) => {
                    if (!thinkingItem || this.session.items[this.session.items.length - 1] !== thinkingItem) {
                        thinkingItem = { kind: 'thinking', id: randomUUID(), text: '' };
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
            if (running.token.isCancellationRequested) {
                this.addItem({ kind: 'notice', id: randomUUID(), tone: 'info', text: 'Stopped.' });
            }
            // The loop works on its own copy; keep what it sent (including compaction) minus the system prompt.
            this.messages = closeDanglingToolCalls(conversation.slice(1));
            this.conversation = undefined;
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
        this.session.items = kept;
        this.usage = undefined;
        this.postState();

        await this.run(text.trim(), item.files ?? []);
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
                steered: true
            });
            messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(item.text, item.files)));
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
            status: 'running'
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

            const output = tool.nova
                ? await tool.nova.invoke(input as never, { token }, preparation)
                : toolResultText((await vscode.lm.invokeTool(call.name, { input, toolInvocationToken: undefined }, token)).content);

            item.status = 'done';
            item.output = clip(output);
            if (preparation.edit && call.name !== 'memory_write') {
                item.diff = diffLines(preparation.edit.original, preparation.edit.proposed, MAX_CARD_DIFF_LINES);
                this.recordChange(preparation.edit);
            }
            updateItem(item);
            return textResult(output);
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

    private async openFile(path: string): Promise<void> {
        try {
            const memoryFile = /^(Global|Project) memory/.exec(path);
            const uri = memoryFile && this.services.memory
                ? vscode.Uri.file(this.services.memory.file(memoryFile[1] === 'Global' ? 'global' : 'project'))
                : resolveWorkspacePath(path);
            await vscode.window.showTextDocument(uri, { preview: true });
        } catch (error) {
            void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async addFile(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}', 5_000);
        const picked = await vscode.window.showQuickPick(
            files.map((uri) => displayPath(uri)).sort().map((label) => ({ label })),
            { placeHolder: 'Add a file to the Nova chat', canPickMany: true, matchOnDescription: true }
        );
        for (const { label } of picked ?? []) {
            this.addAttachment({ id: randomUUID(), path: label, label });
        }
    }

    private addAttachment(attachment: Attachment): void {
        if (!this.attachments.some((existing) => existing.label === attachment.label)) {
            this.attachments = [...this.attachments, attachment];
        }
        this.post({ type: 'chat/attachments', attachments: this.attachments });
    }

    private async open(sessionId: string): Promise<void> {
        if (this.running) {
            return;
        }
        const session = await this.store.load(sessionId);
        if (!session) {
            void vscode.window.showWarningMessage('This Nova chat could not be loaded.');
            return;
        }
        this.loadSession(session);
        await this.workspaceState.update(LAST_SESSION_KEY, session.id);
        this.postState();
    }

    private async deleteSession(sessionId: string): Promise<void> {
        await this.store.delete(sessionId);
        if (sessionId === this.session.id) {
            await this.newChat();
        } else {
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
    }

    private async persist(): Promise<void> {
        this.session.updatedAt = Date.now();
        this.session.messages = toStoredMessages(this.messages);
        try {
            await this.store.save(this.session);
            await this.workspaceState.update(LAST_SESSION_KEY, this.session.id);
            this.postState();
        } catch (error) {
            this.diagnostics.error('Saving the Nova chat failed.', error);
        }
    }

    private addItem(item: ChatItem): void {
        this.session.items.push(item);
        this.post({ type: 'chat/itemAdded', item });
    }

    private updateItem(item: ChatItem): void {
        this.post({ type: 'chat/itemUpdated', item: { ...item } });
    }
}

interface AvailableTool {
    info: vscode.LanguageModelToolInformation;
    readOnly: boolean;
    /** Built-in tool; undefined for tools from other extensions (MCP). */
    nova?: NovaTool<never>;
}

/** Nova's built-in tools plus MCP tools registered in VS Code, which can run without a chat request. */
function availableTools(memory?: MemoryService, interaction?: InteractionHost): AvailableTool[] {
    const novaTools = [
        ...BUILT_IN_TOOLS,
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
async function createSystemMessage(memory?: MemoryService): Promise<vscode.LanguageModelChatMessage> {
    const prompt = createPanelPrompt({
        folders: workspaceFolders().map((folder) => folder.name),
        platform: process.platform,
        shell: vscode.env.shell || undefined,
        scratch: Boolean(getScratchRoot()),
        memory: memory?.isEnabled() ? await memory.promptSection().catch(() => '') : undefined
    });
    const systemRole = getSystemRole();
    return systemRole !== undefined
        ? new vscode.LanguageModelChatMessage(systemRole, prompt)
        : vscode.LanguageModelChatMessage.User(prompt);
}

async function buildPrompt(prompt: string, attachments: readonly Attachment[]): Promise<string> {
    const blocks: string[] = [];
    for (const attachment of attachments) {
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
    return blocks.length ? `<attachments>\n${blocks.join('\n\n')}\n</attachments>\n\n${prompt}` : prompt;
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

function summarizeTitle(text: string): string {
    const line = text.split('\n')[0].trim();
    return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function newSession(): StoredSession {
    const now = Date.now();
    return { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, items: [], messages: [] };
}
