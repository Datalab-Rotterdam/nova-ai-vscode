import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { runAgentLoop, summarize, type AgentLoopHost, type AgentLoopRequest } from '../agent/AgentLoop';
import { BUILT_IN_TOOLS, outputParts, ToolInputError, type NovaTool, type ProposedEdit, type ToolPreparation } from '../agent/tools';
import { diffLines } from './diff';
import { createInteractionTools, type InteractionHost } from '../agent/tools/interactionTools';
import { createMemoryTools } from '../agent/tools/memoryTools';
import { createCodingAgentTool, createSubagentTool, SPAWN_AGENTS_TOOL, START_CODING_AGENT_TOOL, type CodingAgentHost, type SubagentHost, type SubagentOutcome, type SubagentTask } from '../agent/tools/subagentTool';
import { displayPath, getScratchRoot, readText, resolveWorkspacePath, withToolRoot, workspaceFolders } from '../agent/tools/workspacePaths';
import { agentsFolder } from '../agents/AgentsController';
import { agentAllowsTool, findAgent, listAgents, type AgentDefinition, type AgentPaths } from '../agents/AgentService';
import type { HookEvent, HookOutcome, HookService } from '../hooks/HookService';
import type { McpService } from '../mcp/McpService';
import { createMcpTool } from '../mcp/tools';
import type { MemoryService } from '../memory/MemoryService';
import { type PermissionService, suggestRule } from '../permissions/PermissionService';
import { getSystemRole } from '../core/apiSupport';
import { COMMAND_MANAGE_AGENTS, COMMAND_SHOW_HELP } from '../core/constants';
import { buildTranscript, estimateMessagesTokens, summaryBlock, tokenCalibration } from '../agent/ContextManager';
import { getCompactThreshold, getMaxToolRounds, getSubagentSettings, isAutoCompactEnabled } from '../core/config';
import { Diagnostics } from '../core/diagnostics';
import { createCodingAgentPrompt, createPanelPrompt, createSubagentPrompt } from '../core/prompts';
import type { LanguageModelInfo } from '../core/types';
import { toolResultText } from '../model/messages';
import type { ModelProvider } from '../model/modelProvider';
import { createDirectModel } from './directModel';
import { commitChanges, openPullRequest, reviewRequest, type GitCommandHost } from '../git/gitCommands';
import { repoRoot } from '../git/git';
import { baseContent, changedFiles, commitWorktree, createWorktree, mergeWorktree, removeWorktree, type AgentWorktree } from '../git/worktrees';
import type { ProposedContentProvider } from './ProposedContentProvider';
import type {
    ApprovalDecision,
    AgentOption,
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
    SubagentState,
    ToolItem
} from './protocol';
import { enabledSkills, type Skill, type SkillPaths } from '../skills/SkillService';
import { buildSkillsPrompt, createLoadSkillTool } from '../skills/skillTools';
import type { ChatHub } from './ChatHub';
import { parseSlashCommand, type ParsedSlashCommand } from './slashCommands';
import { runIdOf, setRunId, visibleChatItems } from './steps';
import { classifyLink, confirmAndOpenExternal } from './links';
import { toCsv, toXlsx } from './tableExport';
import { ensureDir } from '../storage/NovaHome';
import { confirmAndDeleteChats, type ChatHistory } from './chatSearch';
import { classifyFile } from './drop';
import { fromStoredMessages, type SessionStore, type StoredSession, toStoredMessages } from './SessionStore';

const MAX_ATTACHMENT_CHARS = 60_000;
/** Images the model may see in one run: the newest plus what is already in the conversation. */
const MAX_IMAGES_PER_RUN = 4;
/** Largest file (PDF, spreadsheet, …) that can be attached; it is saved to disk, not sent to the model. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Composer images up to this many bytes; larger than about 2.5 MB of base64 over the message port. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Longest code block the open button hands to an editor. */
const MAX_SNIPPET_CHARS = 2_000_000;
/** Fence tags that are not VS Code language IDs. */
const SNIPPET_LANGUAGES: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact',
    sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', shell: 'shellscript', console: 'shellscript',
    py: 'python', rb: 'ruby', rs: 'rust', cs: 'csharp', 'c++': 'cpp', yml: 'yaml', md: 'markdown', ps1: 'powershell',
    kt: 'kotlin', golang: 'go', objc: 'objective-c', vue: 'html', svg: 'xml'
};
/** File extension for a snippet's language; anything else is .txt. */
const SNIPPET_EXTENSIONS: Record<string, string> = {
    typescript: 'ts', typescriptreact: 'tsx', javascript: 'js', javascriptreact: 'jsx', python: 'py', shellscript: 'sh',
    json: 'json', jsonc: 'jsonc', yaml: 'yml', markdown: 'md', html: 'html', css: 'css', scss: 'scss', less: 'less',
    go: 'go', rust: 'rs', java: 'java', csharp: 'cs', cpp: 'cpp', c: 'c', php: 'php', ruby: 'rb', sql: 'sql', xml: 'xml',
    kotlin: 'kt', swift: 'swift', powershell: 'ps1', diff: 'diff', dockerfile: 'Dockerfile', toml: 'toml', ini: 'ini',
    lua: 'lua', r: 'r', perl: 'pl', dart: 'dart', 'objective-c': 'm', graphql: 'graphql', svelte: 'svelte'
};
const IMAGE_MIME = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp']
]);
const MAX_CARD_OUTPUT_CHARS = 4_000;
/** How long a request waits for MCP servers that are still starting; slower ones join the next request. */
const MCP_START_WAIT_MS = 10_000;
/** How often Stop hooks may send the agent back to work in one answer. */
const MAX_STOP_HOOK_ROUNDS = 3;
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
/** Autopilot works until it is done; this only stops a model that loops forever. */
const AUTOPILOT_MAX_ROUNDS = 1_000;
const AUTOPILOT_ANSWER = 'Autopilot is on and no user is available to answer. Choose the most reasonable option yourself, mention the choice in your summary and continue.';

interface TrackedChange {
    uri: vscode.Uri;
    path: string;
    baseline: string;
    current: string;
    created: boolean;
}
/** Tools rendered by their own UI instead of a tool card. */
const INTERACTION_TOOLS = new Set(['todo_write', 'ask_user']);
/** What a research sub-agent may use: reading, searching, the web and commands; never edits. */
const SUBAGENT_TOOLS = new Set(['read_file', 'list_dir', 'find_files', 'search_text', 'get_diagnostics', 'fetch_url', 'web_search', 'run_command']);
/** What a coding agent may use in its worktree; diagnostics only cover the open workspace. */
const CODING_AGENT_TOOLS = new Set(['read_file', 'list_dir', 'find_files', 'search_text', 'edit_file', 'create_file', 'run_command', 'fetch_url', 'web_search']);

/** A sub-agent's view of a tool call: whose it is, and how the call moves the agent's status. */
interface ToolScope {
    agentId: string;
    /** A coding agent's worktree: its edits need no approval and stay out of the chat's changes. */
    root?: string;
    onTitle(title: string): void;
    onWaiting(waiting: boolean): void;
}

interface CodingJob {
    id: string;
    task: SubagentTask;
    agent: AgentDefinition;
    worktree: AgentWorktree;
}

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
    /** Running sub-agents, to stop one by itself. */
    private readonly subagentRuns = new Map<string, vscode.CancellationTokenSource>();
    /** Sub-agents started while answering the current message, against the per-answer limit. */
    private subagentsStarted = 0;
    /** Coding agents waiting for a free slot (see nova.agent.codingAgents.maxParallel). */
    private codingQueue: CodingJob[] = [];
    private codingRunning = 0;
    /**
     * Coding agents of this controller by id, with the chat they belong to. They outlive the
     * answer, so the user may have opened another chat meanwhile; reopening it shows them live.
     */
    private readonly codingAgents = new Map<string, { state: SubagentState; sessionId: string }>();
    private disposed = false;
    /** The spawn_agents call being run, so the agents it starts can be tied to its card. */
    private spawnCallId = '';
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
        private readonly services: { memory?: MemoryService; permissions?: PermissionService; skillPaths?: () => SkillPaths; agents?: () => AgentPaths; mcp?: McpService; hooks?: HookService; worktrees?: () => string | undefined } = {},
        private readonly options: ChatControllerOptions = {}
    ) {
        this.rememberLast = options.rememberLast ?? true;
        this.disposables.push(this.modelProvider.onDidChangeLanguageModelChatInformation(() => void this.refreshModels().then(() => this.postState())));
        // New and edited agents show in the mode menu at once, not on the next state update.
        const agentPaths = this.services.agents?.();
        for (const folder of agentPaths ? [agentsFolder(agentPaths, 'global'), agentsFolder(agentPaths, 'project')] : []) {
            if (folder) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '*.md'));
                const changed = () => {
                    this.agentCache = undefined;
                    this.postState();
                };
                this.disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed));
            }
        }
        if (options.hub) {
            this.disposables.push(options.hub.onDidChange(() => this.postSessions()));
        }
        if (this.store.onDidChange) {
            this.disposables.push(this.store.onDidChange(() => this.postSessions()));
        }
    }

    public dispose(): void {
        // Coding agents stop with their chat; a reload shows them as interrupted, worktrees kept.
        this.disposed = true;
        this.subagentRuns.forEach((run) => run.cancel());
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
            case 'chat/setEffort':
                this.session.effort = command.effort;
                void this.persist();
                this.postState();
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
            case 'chat/addBinaryFile': {
                const encoded = /^data:[^,]*;base64,([\s\S]*)$/.exec(command.dataUrl)?.[1];
                if (encoded === undefined) {
                    this.notice('warning', `${command.name} could not be read.`);
                } else {
                    await this.attachFileBytes(command.name, Buffer.from(encoded, 'base64'));
                }
                break;
            }
            case 'chat/openDiff':
                await this.openDiff(command.itemId);
                break;
            case 'chat/openFile':
                await this.openFile(command.path);
                break;
            case 'chat/openLink':
                await this.openLink(command.href, command.text);
                break;
            case 'chat/openSnippet':
                await this.openSnippet(command.code, command.language);
                break;
            case 'chat/exportTable':
                await this.exportTable(command.format, command.rows);
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
            case 'chat/stopAgent':
                this.stopSubagent(command.id);
                break;
            case 'chat/agentBranch':
                await this.agentBranch(command.id, command.action);
                break;
            case 'chat/dismissTodos':
                this.session.todos = [];
                this.post({ type: 'chat/todos', todos: [] });
                break;
            case 'chat/editMessage':
                if (this.isLastGroup(command.itemId)) {
                    // The newest question: the edit becomes a new answer version next to the old one.
                    await this.regenerate(command.itemId, command.text);
                } else if (this.findUser(command.itemId)?.branch) {
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
            case 'chat/setAgent':
                this.setAgent(command.id);
                break;
            case 'chat/manageAgents':
                await vscode.commands.executeCommand(COMMAND_MANAGE_AGENTS);
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
    private addImage(name: string, dataUrl: string, workspacePath?: string): void {
        const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/.exec(dataUrl);
        const mimeType = (name && IMAGE_MIME.get(name.split('.').pop()?.toLowerCase() ?? '')) || match?.[1];
        const source = match ? match[2] : dataUrl;
        if (!mimeType || !mimeType.startsWith('image/') || !source) {
            this.notice('warning', 'Only PNG, JPEG and WebP images can be attached.');
            return;
        }
        if (source.length > (MAX_IMAGE_BYTES * 4) / 3 + 4) {
            this.notice('warning', `${name} is too large to attach (at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
            return;
        }
        // An image from the workspace keeps its path, so the model can find the file again with its tools.
        this.addAttachment({
            id: randomUUID(),
            label: workspacePath ?? (name || 'image'),
            ...(workspacePath ? { path: workspacePath } : {}),
            image: { mimeType, data: source }
        });
    }

    /** Adds a text file from outside the workspace as inline content, clipped like attached files. */
    private addTextFile(name: string, content: string): void {
        if (classifyFile(name) !== 'text' || content.includes('\u0000')) {
            this.notice('warning', `${name} is not a text file.`);
            return;
        }
        if (content.length > MAX_ATTACHMENT_CHARS) {
            this.notice('info', `${name} is long; only the first ${MAX_ATTACHMENT_CHARS.toLocaleString()} characters are sent.`);
        }
        this.addAttachment({ id: randomUUID(), label: name, content: content.slice(0, MAX_ATTACHMENT_CHARS) });
    }

    /**
     * Attaches a file that is neither text nor an image (PDF, spreadsheet, archive, …). The bytes
     * are saved in the project's scratch folder, which Nova's tools can read, and only the path
     * goes to the model: it decides how to open the file (see the nova-documents skill).
     */
    private async attachFileBytes(name: string, bytes: Uint8Array): Promise<void> {
        if (bytes.byteLength > MAX_FILE_BYTES) {
            this.notice('warning', `${name} is too large to attach (at most ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
            return;
        }
        const scratch = getScratchRoot();
        if (!scratch) {
            this.notice('warning', `${name} cannot be attached: Nova has no folder to keep it in. Open a folder first.`);
            return;
        }
        const folder = nodePath.join(scratch, 'attachments');
        await ensureDir(folder);
        const safe = nodePath.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_') || 'file';
        const { name: stem, ext } = nodePath.parse(safe);
        // A second file with the same name must not replace the first one.
        for (let n = 1; ; n++) {
            const candidate = n === 1 ? safe : `${stem}-${n}${ext}`;
            try {
                await nodeFs.writeFile(nodePath.join(folder, candidate), bytes, { flag: 'wx', mode: 0o600 });
                this.addAttachment({ id: randomUUID(), label: n === 1 ? name : candidate, path: `scratch/attachments/${candidate}`, binary: { size: bytes.byteLength } });
                this.warnIfFilesCannotBeOpened(name);
                return;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || n > 999) {
                    this.notice('warning', `${name} could not be saved for Nova.`);
                    return;
                }
            }
        }
    }

    /** Nova opens such a file with tools: say so when the agent or model cannot use them. */
    private warnIfFilesCannotBeOpened(name: string): void {
        const model = this.models.find((candidate) => candidate.id === this.selectedModelId());
        if (this.currentAgent().readOnly || model?.capabilities?.toolCalling === false) {
            this.notice('info', `${name} is attached as a file. Nova opens it with tools, which this agent or model cannot run; use an agent that can run commands.`);
        }
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
                const info = await vscode.workspace.fs.stat(uri);
                if (info.type & vscode.FileType.Directory) {
                    this.notice('warning', `${name} is a folder; attach the files in it instead.`);
                    continue;
                }
                if (kind === 'file') {
                    // Not text, not an image: Nova gets the file on disk and opens it with its tools.
                    if (vscode.workspace.getWorkspaceFolder(uri)) {
                        const path = displayPath(uri);
                        this.addAttachment({ id: randomUUID(), path, label: path, binary: { size: info.size ?? 0 } });
                        this.warnIfFilesCannotBeOpened(name);
                    } else if ((info.size ?? 0) > MAX_FILE_BYTES) {
                        this.notice('warning', `${name} is too large to attach (at most ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
                    } else {
                        await this.attachFileBytes(name, await vscode.workspace.fs.readFile(uri));
                    }
                } else if (kind === 'image') {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    this.addImage(
                        name,
                        `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`,
                        vscode.workspace.getWorkspaceFolder(uri) ? displayPath(uri) : undefined
                    );
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
        const agentId = this.session.agentId;
        this.session = { ...newSession(), ...(agentId ? { agentId } : {}) };
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
            effort: this.currentEffort(),
            attachments: this.attachments,
            usage: this.usage,
            sessions: this.store.list(),
            openElsewhere: this.openElsewhere(),
            approvalMode: getApprovalMode(),
            agent: this.currentAgent().id,
            agents: this.agentOptions(),
            queue: this.queueView(),
            todos: this.session.todos ?? [],
            changes: this.changesView(),
            subagents: this.session.subagents ?? [],
            fileOptions: this.fileOptions()
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
    /** The chat's effort when the selected model accepts it, else "none" for a model that thinks only on request, else its middle level. */
    private currentEffort(): string | undefined {
        const model = this.models.find((candidate) => candidate.id === this.selectedModelId());
        const efforts = effortsOf(model);
        if (!efforts.length) {
            return undefined;
        }
        if (efforts.includes(this.session.effort ?? '')) {
            return this.session.effort;
        }
        if (efforts.includes('none') && model?.raw?.reasoning_default === 'off') {
            return 'none';
        }
        return efforts.includes('medium') ? 'medium' : efforts[Math.floor((efforts.length - 1) / 2)];
    }

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
            case 'commit':
                await this.gitTask((host, token) => commitChanges(host, args, token));
                break;
            case 'pr':
                await this.gitTask((host, token) => openPullRequest(host, args, token));
                break;
            case 'review':
                await this.review(args);
                break;
            case 'help':
                await vscode.commands.executeCommand(COMMAND_SHOW_HELP);
                break;
        }
    }

    /** `/commit` and `/pr`: git work with one model answer in between, shown as running so Stop cancels it. */
    private async gitTask(work: (host: GitCommandHost, token: vscode.CancellationToken) => Promise<void>): Promise<void> {
        if (this.running) {
            this.notice('warning', 'Nova is working. Run the command after the reply, or stop it first.');
            return;
        }
        if (!this.models.length) {
            await this.refreshModels();
        }
        const info = this.models.find((candidate) => candidate.id === this.selectedModelId());
        const model = info ? createDirectModel(this.modelProvider, info) : undefined;
        if (!model) {
            this.notice('error', 'No Nova model is available. Connect Nova AI or refresh the models.');
            return;
        }
        await this.track((async () => {
            const running = new vscode.CancellationTokenSource();
            this.running = running;
            this.post({ type: 'chat/running', running: true });
            try {
                await work(this.gitHost(model), running.token);
            } catch (error) {
                if (!running.token.isCancellationRequested) {
                    this.diagnostics.error('A git command failed.', error);
                    this.notice('error', error instanceof Error ? error.message : String(error));
                }
            } finally {
                this.running = undefined;
                running.dispose();
                this.post({ type: 'chat/running', running: false });
                await this.persist();
                this.drainQueue();
            }
        })());
    }

    /** `/review`: a normal request with the branch's diff attached. */
    private async review(base: string): Promise<void> {
        if (this.running) {
            this.notice('warning', 'Nova is working. Use /review after the reply, or stop it first.');
            return;
        }
        try {
            const request = await reviewRequest(this.gitHost(), base);
            if (request) {
                await this.run(request.prompt, request.attachments);
            }
        } catch (error) {
            this.notice('error', error instanceof Error ? error.message : String(error));
        }
    }

    private gitHost(model?: vscode.LanguageModelChat): GitCommandHost {
        return {
            cwd: () => workspaceFolders()[0]?.uri.fsPath,
            complete: async (prompt, token) => {
                if (!model) {
                    throw new Error('No model is available.');
                }
                const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
                let text = '';
                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        text += part.value;
                    }
                }
                return text;
            },
            notice: (tone, text) => this.notice(tone, text),
            openExternal: async (url) => {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        };
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

        // Hooks may block the message or add context for the model; SessionStart only before the first message.
        const hookToken = new vscode.CancellationTokenSource();
        const started = this.messages.length ? undefined : await this.runHooks('SessionStart', { source: 'startup' }, hookToken.token);
        const submitted = await this.runHooks('UserPromptSubmit', { prompt }, hookToken.token);
        hookToken.dispose();
        if (submitted.block) {
            this.addItem({ kind: 'notice', id: randomUUID(), tone: 'warning', text: `A hook blocked this message: ${submitted.block}` });
            return;
        }
        const hookContext = [started?.context, submitted.context].filter(Boolean).join('\n');

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
        this.subagentsStarted = 0;

        this.messages.push(vscode.LanguageModelChatMessage.User(await buildPrompt(hookContext ? `${prompt}\n\n${hookContext}` : prompt, this.fitImages(attachments))));

        const running = new vscode.CancellationTokenSource();
        this.running = running;
        this.post({ type: 'chat/running', running: true });

        // Only the skills that are on, and their list ranked by this message (see skillTools).
        const skills = this.services.skillPaths ? enabledSkills(this.services.skillPaths()) : [];
        const agent = this.currentAgent();
        const subagentSettings = getSubagentSettings();
        const subagentsOn = subagentSettings.enabled && agentAllowsTool(agent, SPAWN_AGENTS_TOOL);
        const conversation = [await createSystemMessage(this.services.memory, buildSkillsPrompt(skills, prompt), agent.prompt, subagentsOn
            ? { maxPerCall: subagentSettings.maxPerCall, maxParallel: subagentSettings.maxParallel, maxTotal: subagentSettings.maxTotalPerRun }
            : undefined), ...this.messages];
        this.conversation = conversation;
        await this.services.mcp?.ensureStarted(MCP_START_WAIT_MS);
        const repo = subagentSettings.codingAgents && !agent.readOnly && agentAllowsTool(agent, START_CODING_AGENT_TOOL) && this.services.worktrees?.()
            ? await repoRoot(workspaceFolders()[0]?.uri.fsPath ?? '').catch(() => undefined)
            : undefined;
        const tools = availableTools(this.services.memory, this.interactionHost(), skills, subagentsOn ? this.subagentHost(agent) : undefined, this.services.mcp, repo ? this.codingAgentHost(agent, repo) : undefined)
            .filter((tool) => agentAllowsTool(agent, tool.info.name, tool.mcp) && (!agent.readOnly || tool.readOnly));
        let assistantItem: Extract<ChatItem, { kind: 'assistant' }> | undefined;
        let thinkingItem: Extract<ChatItem, { kind: 'thinking' }> | undefined;
        this.activeThinking = undefined;
        this.activeAssistants = [];

        try {
            const effort = this.currentEffort();
            const loopRequest: AgentLoopRequest = {
                model,
                messages: conversation,
                modelOptions: effort ? { reasoning_effort: effort } : undefined,
                pinned: 1,
                tools: tools.map((tool) => tool.info),
                invokeTool: (call, token) => this.invokeTool(tools, call, token),
                maxRounds: agent.autopilot ? AUTOPILOT_MAX_ROUNDS : getMaxToolRounds(),
                autoCompact: isAutoCompactEnabled(),
                compactThreshold: getCompactThreshold(),
                takeSteering: () => this.takeSteering()
            };
            const loopHost: AgentLoopHost = {
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
            };
            let result = await runAgentLoop(loopRequest, loopHost, running.token);
            // A Stop hook can send the agent back to work (for example until the tests pass), a few times at most.
            for (let round = 0; round < MAX_STOP_HOOK_ROUNDS && !result.hitRoundLimit && !running.token.isCancellationRequested; round++) {
                const stop = await this.runHooks('Stop', { stop_hook_active: round > 0 }, running.token);
                if (!stop.block || running.token.isCancellationRequested) {
                    break;
                }
                this.addItem({ kind: 'notice', id: randomUUID(), tone: 'info', text: `A Stop hook asked Nova to continue: ${stop.block}` });
                conversation.push(vscode.LanguageModelChatMessage.User(`A Stop hook did not let you finish yet:\n${stop.block}\nContinue the task.`));
                result = await runAgentLoop(loopRequest, loopHost, running.token);
            }

            if (result.hitRoundLimit && !agent.autopilot) {
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
            this.settleSubagents();
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

    /** True when no later question follows the answer group of this message, so new versions can sit at the end. */
    private isLastGroup(itemId: string): boolean {
        const target = this.findUser(itemId);
        if (!target) {
            return false;
        }
        const host = this.hostIdOf(target);
        const items = this.session.items;
        const start = items.findIndex((item) => item.kind === 'user' && (item.id === host || item.branch?.hostId === host));
        return !items.some((item, index) => index > start && item.kind === 'user' && item.id !== host && item.branch?.hostId !== host);
    }

    /**
     * Adds a new answer version next to `itemId` and makes it current: a regenerated answer, or,
     * with `text`, the same question edited. The previous version stays behind the version switcher.
     */
    private async regenerate(itemId: string, text?: string): Promise<void> {
        const target = this.findUser(itemId);
        if (!target || (text !== undefined && !text.trim() && !target.files?.length)) {
            return;
        }
        await this.settleIfRunning();
        this.stampRunIds();
        const host = this.hostIdOf(target);

        const branchItem: Extract<ChatItem, { kind: 'user' }> = {
            kind: 'user',
            id: randomUUID(),
            text: text?.trim() ?? target.text,
            attachments: target.attachments,
            files: target.files,
            model: this.runModelName,
            branch: { hostId: host, modelId: this.selectedModelId(), current: true }
        };
        this.session.items.push(branchItem);
        // The previous answer is no longer the context a fresh run should keep.
        await this.activate(branchItem, false);
        // Show the new version now: the old one is hidden at once, not when the first reply step arrives.
        this.postState();
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

    // --- Sub-agents (spawn_agents) ---

    private postSubagents(): void {
        this.post({ type: 'chat/subagents', subagents: [...(this.session.subagents ?? [])] });
    }

    /** The model a sub-agent uses: the one Nova chose (if allowed), else the setting, else the chat's own model. */
    private resolveSubagentModel(requested?: string): LanguageModelInfo | undefined {
        const settings = getSubagentSettings();
        const find = (id: string | undefined) => this.models.find((model) => model.id === id);
        return (requested && settings.allowedModels.includes(requested) ? find(requested) : undefined)
            ?? (settings.model !== 'inherit' ? find(settings.model) : undefined)
            ?? find(this.selectedModelId());
    }

    private subagentHost(agent: AgentDefinition): SubagentHost {
        const settings = getSubagentSettings();
        return {
            limits: () => ({ maxPerCall: settings.maxPerCall, maxParallel: settings.maxParallel }),
            models: () => this.models
                .filter((model) => settings.allowedModels.includes(model.id))
                .map((model) => ({ id: model.id, name: model.name })),
            reserve: (count) => {
                if (this.subagentsStarted + count > settings.maxTotalPerRun) {
                    throw new ToolInputError(`Agent limit for this answer reached (${settings.maxTotalPerRun}; ${this.subagentsStarted} started). Continue with what you have, or do the rest yourself.`);
                }
                this.subagentsStarted += count;
            },
            register: (tasks) => {
                const states = tasks.map((task): SubagentState => ({
                    id: randomUUID(),
                    name: task.name,
                    task: task.prompt,
                    status: 'queued',
                    model: this.resolveSubagentModel(task.model)?.name ?? '',
                    toolCount: 0,
                    rounds: 0,
                    tokens: 0,
                    callId: this.spawnCallId,
                    runId: this.currentRunUser?.id
                }));
                this.session.subagents = [...(this.session.subagents ?? []), ...states];
                this.postSubagents();
                return states.map((state) => state.id);
            },
            run: (id, task, token) => this.runSubagent(id, task, token, agent)
        };
    }

    /** Runs a research agent, or with `worktree` a coding agent rooted in its own worktree. */
    private async runSubagent(id: string, task: SubagentTask, parent: vscode.CancellationToken, agent: AgentDefinition, worktree?: AgentWorktree): Promise<SubagentOutcome> {
        const state = this.session.subagents?.find((candidate) => candidate.id === id);
        if (!state) {
            throw new Error('Unknown agent.');
        }
        if (state.status === 'stopped') {
            return { status: 'stopped', report: 'Stopped by the user before it started.', rounds: 0, tokens: 0, model: state.model };
        }
        const info = this.resolveSubagentModel(task.model);
        if (!info) {
            throw new Error('No model is available for the agent.');
        }
        const model = createDirectModel(this.modelProvider, info);
        const settings = getSubagentSettings();
        // Same limits as the main agent's mode: a read-only mode gives read-only agents, and no mode lends an agent more than it has itself.
        const allowed = worktree ? CODING_AGENT_TOOLS : SUBAGENT_TOOLS;
        const maxRounds = worktree ? settings.codingRounds : settings.maxRounds;
        const tools = availableTools()
            .filter((tool) => allowed.has(tool.info.name) && agentAllowsTool(agent, tool.info.name, false) && (!agent.readOnly || tool.readOnly));
        const own = new vscode.CancellationTokenSource();
        this.subagentRuns.set(id, own);
        const link = parent.onCancellationRequested(() => own.cancel());
        const touch = () => this.postSubagents();

        state.status = 'running';
        state.startedAt = Date.now();
        state.model = info.name;
        touch();

        const system = worktree
            ? createCodingAgentPrompt({ branch: worktree.branch, platform: process.platform, shell: vscode.env.shell || undefined })
            : createSubagentPrompt({
                folders: workspaceFolders().map((folder) => folder.name),
                platform: process.platform,
                shell: vscode.env.shell || undefined,
                canRun: tools.some((tool) => tool.info.name === 'run_command')
            });
        const systemRole = getSystemRole();
        const messages = [
            systemRole !== undefined ? new vscode.LanguageModelChatMessage(systemRole, system) : vscode.LanguageModelChatMessage.User(system),
            vscode.LanguageModelChatMessage.User(task.prompt)
        ];
        const scope: ToolScope = {
            agentId: id,
            root: worktree?.path,
            onTitle: (title) => {
                state.currentTool = title;
                touch();
            },
            onWaiting: (waiting) => {
                state.status = waiting ? 'waiting-approval' : 'running';
                touch();
            }
        };

        try {
            const loop = () => runAgentLoop({
                model,
                messages,
                pinned: 1,
                tools: tools.map((tool) => tool.info),
                invokeTool: (call, token) => this.invokeTool(tools, call, token, scope),
                maxRounds,
                autoCompact: isAutoCompactEnabled(),
                compactThreshold: getCompactThreshold()
            }, {
                text: () => undefined,
                toolCall: () => {
                    state.toolCount++;
                    touch();
                },
                toolResult: () => {
                    state.currentTool = undefined;
                    touch();
                },
                usage: (promptTokens) => {
                    state.rounds++;
                    state.tokens += promptTokens;
                    touch();
                }
            }, own.token);
            const result = await (worktree ? withToolRoot(worktree.path, loop) : loop());
            state.tokens = result.promptTokens + result.completionTokens || state.tokens;
            const stopped = own.token.isCancellationRequested;
            state.status = stopped ? 'stopped' : 'done';
            state.report = (result.finalText.trim() || (stopped ? 'Stopped before a report was written.' : '(no report)'))
                + (result.hitRoundLimit && !stopped ? `\n\n(The agent hit its limit of ${maxRounds} rounds; this report may be incomplete.)` : '');
        } catch (error) {
            const stopped = own.token.isCancellationRequested;
            state.status = stopped ? 'stopped' : 'error';
            state.report = stopped ? 'Stopped.' : error instanceof Error ? error.message : String(error);
        } finally {
            link.dispose();
            own.dispose();
            this.subagentRuns.delete(id);
            state.currentTool = undefined;
            state.endedAt = Date.now();
            touch();
        }
        return { status: state.status === 'done' ? 'done' : state.status === 'stopped' ? 'stopped' : 'error', report: state.report ?? '', rounds: state.rounds, tokens: state.tokens, model: state.model };
    }

    private stopSubagent(id: string): void {
        const run = this.subagentRuns.get(id);
        if (run) {
            run.cancel();
            // Its approval card (if it waits for one) is answered too.
            for (const item of this.session.items) {
                if (item.kind === 'tool' && item.agentId === id && item.status === 'awaiting-approval') {
                    this.approvals.get(item.id)?.resolve('reject');
                }
            }
            return;
        }
        const state = this.session.subagents?.find((candidate) => candidate.id === id);
        if (state?.status === 'queued') {
            state.status = 'stopped';
            state.report = 'Stopped by the user before it started.';
            this.postSubagents();
        }
    }

    /** Agents still marked as waiting or running when the answer ends were cut off with it. */
    private settleSubagents(): void {
        let changed = false;
        for (const state of this.session.subagents ?? []) {
            if (!state.background && (state.status === 'queued' || state.status === 'running' || state.status === 'waiting-approval')) {
                state.status = 'stopped';
                state.endedAt = Date.now();
                changed = true;
            }
        }
        if (changed) {
            this.postSubagents();
        }
    }

    /** start_coding_agent: each agent gets a branch and worktree, then runs (or queues) without blocking the answer. */
    private codingAgentHost(agent: AgentDefinition, repo: string): CodingAgentHost {
        const settings = getSubagentSettings();
        return {
            models: () => this.models
                .filter((model) => settings.allowedModels.includes(model.id))
                .map((model) => ({ id: model.id, name: model.name })),
            start: async (task) => {
                const dir = this.services.worktrees?.();
                if (!dir) {
                    throw new ToolInputError('Coding agents need an open folder.');
                }
                const id = randomUUID();
                let worktree: AgentWorktree;
                try {
                    worktree = await createWorktree(repo, dir, task.name, id);
                } catch (error) {
                    throw new ToolInputError(`Could not create a worktree for the agent: ${error instanceof Error ? error.message : String(error)}`);
                }
                const state: SubagentState = {
                    id,
                    name: task.name,
                    task: task.prompt,
                    status: 'queued',
                    model: this.resolveSubagentModel(task.model)?.name ?? '',
                    toolCount: 0,
                    rounds: 0,
                    tokens: 0,
                    callId: '',
                    runId: this.currentRunUser?.id,
                    background: { repo, worktree: worktree.path, branch: worktree.branch, base: worktree.base }
                };
                this.session.subagents = [...(this.session.subagents ?? []), state];
                this.codingAgents.set(id, { state, sessionId: this.session.id });
                this.postSubagents();
                this.codingQueue.push({ id, task, agent, worktree });
                const queued = this.codingRunning >= settings.maxBackground;
                this.pumpCodingQueue();
                return { branch: worktree.branch, queued };
            }
        };
    }

    /** Starts queued coding agents while there are free slots. */
    private pumpCodingQueue(): void {
        const max = getSubagentSettings().maxBackground;
        while (!this.disposed && this.codingRunning < max && this.codingQueue.length) {
            const job = this.codingQueue.shift()!;
            this.codingRunning++;
            void this.runCodingAgent(job).finally(() => {
                this.codingRunning--;
                this.pumpCodingQueue();
            });
        }
    }

    /** Runs one coding agent to the end, commits what it changed on its branch and tells the user. */
    private async runCodingAgent(job: CodingJob): Promise<void> {
        const state = this.codingAgents.get(job.id)?.state;
        if (!state?.background || state.status === 'stopped') {
            return;
        }
        // Not tied to the answer that started it: only its own Stop (or closing the chat) ends it.
        await this.runSubagent(job.id, job.task, new vscode.CancellationTokenSource().token, job.agent, job.worktree)
            .catch((error: unknown) => {
                state.status = 'error';
                state.report = error instanceof Error ? error.message : String(error);
            });
        if (this.disposed) {
            state.status = 'interrupted';
            return;
        }
        try {
            await commitWorktree(job.worktree, `${state.name}\n\nWritten by a Nova coding agent.\n\n${state.task}`);
            state.background.files = (await changedFiles(job.worktree)).length;
        } catch (error) {
            this.diagnostics.error('Committing a coding agent\'s work failed.', error);
        }
        const files = state.background.files ?? 0;
        // runSubagent moved the status on; read it again rather than the narrowed value from above.
        const status = (state as SubagentState).status;
        const verb = status === 'done' ? 'finished' : status === 'stopped' ? 'was stopped' : 'failed';
        const text = `Coding agent "${state.name}" ${verb} on ${state.background.branch}: ${files ? `${files} ${files === 1 ? 'file' : 'files'} changed` : 'no changes'}.`;
        await this.saveCodingAgent(state, { tone: status === 'error' ? 'warning' : 'info', text });
        const actions = files ? ['Review Changes', 'Merge', 'Discard'] : ['Discard'];
        void vscode.window.showInformationMessage(text, ...actions).then((choice) => {
            const action = choice === 'Review Changes' ? 'review' : choice === 'Merge' ? 'merge' : choice === 'Discard' ? 'discard' : undefined;
            if (action) {
                void this.agentBranch(job.id, action);
            }
        });
    }

    /** Review, merge, discard or open a coding agent's branch. */
    private async agentBranch(id: string, action: 'review' | 'merge' | 'discard' | 'open'): Promise<void> {
        const state = this.codingAgents.get(id)?.state ?? this.session.subagents?.find((candidate) => candidate.id === id);
        const background = state?.background;
        if (!state || !background || background.outcome) {
            return;
        }
        const worktree: AgentWorktree = { repo: background.repo, path: background.worktree, branch: background.branch, base: background.base };
        const live = state.status === 'queued' || state.status === 'running' || state.status === 'waiting-approval';
        let done: string | undefined;
        try {
            switch (action) {
                case 'open':
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), { forceNewWindow: true });
                    return;
                case 'review':
                    await this.reviewAgentChanges(state.name, worktree);
                    return;
                case 'merge': {
                    if (live) {
                        this.notice('warning', `"${state.name}" is still working. Stop it or wait until it is done, then merge.`);
                        return;
                    }
                    const confirmed = await vscode.window.showInformationMessage(`Merge ${worktree.branch} into your current branch?`, {
                        modal: true,
                        detail: 'The branch is merged with a merge commit; its worktree and branch are removed afterwards.'
                    }, 'Merge');
                    if (confirmed !== 'Merge') {
                        return;
                    }
                    // An interrupted agent may have left changes that were never committed.
                    await commitWorktree(worktree, `${state.name}\n\nWritten by a Nova coding agent.`);
                    const merged = await mergeWorktree(worktree);
                    if (!merged.ok) {
                        this.notice('error', merged.reason);
                        return;
                    }
                    await removeWorktree(worktree);
                    background.outcome = 'merged';
                    done = `Merged ${worktree.branch} into ${merged.into}.`;
                    break;
                }
                case 'discard': {
                    const confirmed = await vscode.window.showWarningMessage(`Discard the work of "${state.name}"?`, {
                        modal: true,
                        detail: `Deletes the branch ${worktree.branch} and its worktree. This cannot be undone.`
                    }, 'Discard');
                    if (confirmed !== 'Discard') {
                        return;
                    }
                    if (live) {
                        this.stopSubagent(id);
                    }
                    await removeWorktree(worktree);
                    background.outcome = 'discarded';
                    done = `Discarded ${worktree.branch}.`;
                    break;
                }
            }
        } catch (error) {
            this.notice('error', error instanceof Error ? error.message : String(error));
            return;
        }
        await this.saveCodingAgent(state, done ? { tone: 'info', text: done } : undefined);
    }

    /**
     * Saves a coding agent's state, with an optional notice, in the chat it belongs to: this one
     * when it is open, otherwise the saved copy on disk.
     */
    private async saveCodingAgent(state: SubagentState, notice?: { tone: 'info' | 'warning'; text: string }): Promise<void> {
        const sessionId = this.codingAgents.get(state.id)?.sessionId ?? this.session.id;
        if (sessionId === this.session.id) {
            if (notice) {
                this.notice(notice.tone, notice.text);
            }
            this.postSubagents();
            await this.persist();
            return;
        }
        const stored = await this.store.load(sessionId);
        if (!stored) {
            return;
        }
        stored.subagents = (stored.subagents ?? []).map((agent) => agent.id === state.id ? state : agent);
        if (notice) {
            stored.items.push({ kind: 'notice', id: randomUUID(), tone: notice.tone, text: notice.text });
        }
        await this.store.save(stored);
    }

    /** All files the agent changed, side by side with how they were when it started. */
    private async reviewAgentChanges(name: string, worktree: AgentWorktree): Promise<void> {
        const files = await changedFiles(worktree);
        if (!files.length) {
            this.notice('info', `${worktree.branch} has no changes.`);
            return;
        }
        const resources = await Promise.all(files.map(async (file) => {
            const key = `${worktree.branch}:${file.path}`;
            const original = this.proposedContent.register(`${key}-base`, file.path, await baseContent(worktree, file.path));
            const modified = file.status === 'D'
                ? this.proposedContent.register(`${key}-deleted`, file.path, '')
                : vscode.Uri.file(nodePath.join(worktree.path, file.path));
            return [modified, original, modified] as const;
        }));
        await vscode.commands.executeCommand('vscode.changes', `${name} (${worktree.branch})`, resources);
    }

    private interactionHost(): InteractionHost {
        return {
            setTodos: (todos) => {
                this.session.todos = todos;
                this.post({ type: 'chat/todos', todos });
            },
            ask: (question, token) => this.currentAgent().autopilot ? Promise.resolve(AUTOPILOT_ANSWER) : new Promise((resolve) => {
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
        // Coding agents work on beyond the answer; their own Stop answers their approvals.
        const coding = new Set([...this.codingAgents.keys()]);
        for (const [itemId, approval] of this.approvals) {
            const item = this.session.items.find((candidate) => candidate.id === itemId);
            if (!(item?.kind === 'tool' && item.agentId && coding.has(item.agentId))) {
                approval.resolve('reject');
            }
        }
    }

    private async invokeTool(
        tools: readonly AvailableTool[],
        call: vscode.LanguageModelToolCallPart,
        token: vscode.CancellationToken,
        scope?: ToolScope
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
            runId: this.currentRunUser?.id,
            ...(scope ? { agentId: scope.agentId } : {})
        };
        if (call.name === SPAWN_AGENTS_TOOL) {
            this.spawnCallId = call.callId;
        }
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
            scope?.onTitle(preparation.title);
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

            const pre = await this.runHooks('PreToolUse', { tool_name: call.name, tool_input: input }, token);
            if (pre.block) {
                item.status = 'rejected';
                item.output = `Blocked by a hook: ${pre.block}`;
                updateItem(item);
                return textResult(`A hook blocked this tool call:\n${pre.block}`);
            }

            // A coding agent's edits land in its own worktree; the user reviews the branch instead.
            const isolatedEdit = !!scope?.root && !!preparation.edit;
            if (rule !== 'allow' && !pre.allow && !isolatedEdit && this.needsApproval(tool)) {
                item.status = 'awaiting-approval';
                if (this.services.permissions) {
                    item.allowRule = suggestRule(call.name, input, workspaceFolders()[0]?.uri.fsPath);
                }
                updateItem(item);
                scope?.onWaiting(true);
                const decision = await this.waitForApproval(item.id, token);
                scope?.onWaiting(false);
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
            let content = tool.nova
                ? outputParts(await tool.nova.invoke(input as never, { token }, preparation))
                : (await vscode.lm.invokeTool(call.name, { input, toolInvocationToken: undefined }, token)).content;
            let output = toolResultText(content);
            const post = await this.runHooks('PostToolUse', { tool_name: call.name, tool_input: input, tool_response: output }, token);
            const feedback = [post.block, post.context].filter(Boolean).join('\n');
            if (feedback) {
                content = [...content, new vscode.LanguageModelTextPart(`Hook feedback:\n${feedback}`)];
                output += `\n\nHook feedback:\n${feedback}`;
            }

            item.status = 'done';
            item.output = clip(output);
            if (preparation.edit && call.name !== 'memory_write') {
                item.diff = diffLines(preparation.edit.original, preparation.edit.proposed, MAX_CARD_DIFF_LINES);
                if (!scope?.root) {
                    this.recordChange(preparation.edit);
                }
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

    /** Runs the event's hooks for this chat; failed hooks show as warnings. */
    private async runHooks(event: HookEvent, payload: Record<string, unknown>, token: vscode.CancellationToken): Promise<HookOutcome> {
        const outcome = await this.services.hooks?.run(event, { session_id: this.session.id, ...payload }, token) ?? { warnings: [] };
        for (const warning of outcome.warnings) {
            this.addItem({ kind: 'notice', id: randomUUID(), tone: 'warning', text: warning });
        }
        return outcome;
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
    /** Opens a code block of an answer as an untitled file, with its language, to read in full or save. */
    private async openSnippet(code: unknown, language: unknown): Promise<void> {
        if (typeof code !== 'string' || !code || code.length > MAX_SNIPPET_CHARS) {
            return;
        }
        const tag = typeof language === 'string' ? language.toLowerCase() : '';
        const id = SNIPPET_LANGUAGES[tag] ?? tag;
        const known = id ? await vscode.languages.getLanguages() : [];
        const languageId = known.includes(id) ? id : 'plaintext';
        // snippet.ts, then snippet-2.ts, … so a second snippet does not reopen the first.
        const extension = SNIPPET_EXTENSIONS[languageId] ?? 'txt';
        const open = new Set(vscode.workspace.textDocuments.map((document) => document.uri.toString()));
        let uri = vscode.Uri.from({ scheme: 'untitled', path: `snippet.${extension}` });
        for (let n = 2; open.has(uri.toString()); n++) {
            uri = vscode.Uri.from({ scheme: 'untitled', path: `snippet-${n}.${extension}` });
        }
        let document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), code));
        if (document.languageId !== languageId) {
            document = await vscode.languages.setTextDocumentLanguage(document, languageId);
        }
    }

    /** Asks where to save a table of an answer and writes it as CSV or Excel. */
    private async exportTable(format: 'csv' | 'xlsx', rows: unknown): Promise<void> {
        const valid = Array.isArray(rows) && rows.length > 0 && rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'));
        if (!valid) {
            return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({
            defaultUri: folder ? vscode.Uri.joinPath(folder, `table.${format}`) : undefined,
            filters: format === 'csv' ? { 'CSV file': ['csv'] } : { 'Excel workbook': ['xlsx'] },
            saveLabel: 'Save table'
        });
        if (!target) {
            return;
        }
        try {
            const data = format === 'csv' ? new TextEncoder().encode(toCsv(rows as string[][])) : toXlsx(rows as string[][]);
            await vscode.workspace.fs.writeFile(target, data);
        } catch (error) {
            void vscode.window.showErrorMessage(`The table could not be saved: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const open = await vscode.window.showInformationMessage(`Saved ${displayPath(target)}.`, 'Open');
        if (open) {
            await vscode.env.openExternal(target);
        }
    }

    private async openLink(href: string, text: string): Promise<void> {
        const link = classifyLink(href);
        if (link.kind === 'external') {
            await confirmAndOpenExternal(link.url, text);
        } else if (link.kind === 'file') {
            await this.openFileLink(link.path, link.line, link.column);
        } else {
            void vscode.window.showWarningMessage(link.reason);
        }
    }

    private agentCache?: { at: number; agents: AgentDefinition[] };

    /** Agents on disk, re-read when older than a couple of seconds so edits show up. */
    private agents(): AgentDefinition[] {
        const paths = this.services.agents?.();
        if (!paths) {
            return listAgents({ builtinDir: '', novaHome: '' });
        }
        if (!this.agentCache || Date.now() - this.agentCache.at > 2_000) {
            this.agentCache = { at: Date.now(), agents: listAgents(paths) };
        }
        return this.agentCache.agents;
    }

    private currentAgent(): AgentDefinition {
        return findAgent(this.agents(), this.session.agentId);
    }

    private agentOptions(): AgentOption[] {
        return this.agents()
            .filter((agent) => agent.selectable)
            .map(({ id, name, description, icon, source }) => ({ id, name, description, icon, source }));
    }

    private setAgent(id: string): void {
        const agent = findAgent(this.agents(), id);
        this.session.agentId = agent.id === 'interactive' ? undefined : agent.id;
        if (this.session.items.length) {
            void this.persist();
        } else {
            this.postState();
        }
    }

    /**
     * Opens a file named in an answer. A workspace file opens in the editor (images, PDFs and the
     * like in their own viewer) at its line, a folder is revealed in the Explorer, and a path
     * outside the workspace is shown in Finder / the file manager, not opened. A name that is not
     * where it was said to be is looked up in the workspace.
     */
    private async openFileLink(rawPath: string, line?: number, column?: number): Promise<void> {
        if (/^(Global|Project) memory/.test(rawPath)) {
            await this.openFile(rawPath, line);
            return;
        }
        const expanded = rawPath.startsWith('~/') || rawPath === '~' ? nodePath.join(nodeOs.homedir(), rawPath.slice(1)) : rawPath;
        let uri: vscode.Uri | undefined;
        let outside = false;
        try {
            uri = resolveWorkspacePath(expanded);
        } catch {
            if (nodePath.isAbsolute(expanded)) {
                uri = vscode.Uri.file(nodePath.normalize(expanded));
                outside = true;
            }
        }
        let type = uri ? await this.fileType(uri) : undefined;
        if (!type && !outside) {
            // Not there: a bare name or a partial path is looked up in the workspace.
            uri = await this.findInWorkspace(expanded);
            type = uri ? await this.fileType(uri) : undefined;
        }
        if (!uri || !type) {
            void vscode.window.showWarningMessage(`${rawPath} was not found.`);
            return;
        }
        if (outside) {
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } else if (type & vscode.FileType.Directory) {
            await vscode.commands.executeCommand('revealInExplorer', uri);
        } else {
            const position = line ? new vscode.Position(line - 1, Math.max(0, (column ?? 1) - 1)) : undefined;
            await vscode.commands.executeCommand('vscode.open', uri, { preview: true, ...(position ? { selection: new vscode.Range(position, position) } : {}) });
        }
    }

    private async fileType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
        try {
            return (await vscode.workspace.fs.stat(uri)).type;
        } catch {
            return undefined;
        }
    }

    /** The workspace file a name or partial path points to; asks which when several match. */
    private async findInWorkspace(name: string): Promise<vscode.Uri | undefined> {
        const pattern = name.replace(/^(?:\.{1,2}[\\/])+/, '').replace(/\\/g, '/');
        if (!pattern || /[*?[\]{}]/.test(pattern)) {
            return undefined;
        }
        const matches = await vscode.workspace.findFiles(`**/${pattern}`, '**/{node_modules,.git}/**', 20);
        if (matches.length <= 1) {
            return matches[0];
        }
        const picked = await vscode.window.showQuickPick(
            matches.map((uri) => ({ label: nodePath.basename(uri.fsPath), description: displayPath(uri), uri })),
            { placeHolder: `Several files match ${name}` }
        );
        return picked?.uri;
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

    /** Picks files or images with the system dialog (opened in the workspace) and attaches them like dropped ones. */
    private async addFile(): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: workspaceFolders()[0]?.uri,
            title: 'Attach files or images to the Nova chat',
            openLabel: 'Attach'
        });
        if (picked?.length) {
            await this.attachUris(picked.map((uri) => uri.toString()));
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
                : item.kind === 'question' && item.status === 'pending' ? { ...item, status: 'skipped' } : item),
            subagents: session.subagents?.map((agent) => this.codingAgents.get(agent.id)?.state ?? agent).map((agent) => agent.status === 'done' || agent.status === 'error' || agent.status === 'stopped' || agent.status === 'interrupted'
                ? agent
                : { ...agent, status: agent.background ? 'interrupted' : 'stopped' })
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
    /** Nova's own tool; undefined for tools from other extensions (MCP). */
    nova?: NovaTool<never>;
    /** An MCP tool: Nova's own client or VS Code's. */
    mcp: boolean;
}

/**
 * Nova's built-in tools, the tools of Nova's own MCP servers, and MCP tools registered in
 * VS Code, which can run without a chat request. A server both know is used through Nova's
 * client, which honours its read-only hints and keeps its connection.
 */
function availableTools(memory?: MemoryService, interaction?: InteractionHost, skills: readonly Skill[] = [], subagents?: SubagentHost, mcpService?: McpService, codingAgents?: CodingAgentHost): AvailableTool[] {
    const webSearchEnabled = vscode.workspace.getConfiguration('nova.webSearch').get<boolean>('enabled', true);
    const novaTools = [
        ...BUILT_IN_TOOLS.filter((tool) => tool.name !== 'web_search' || webSearchEnabled),
        ...(skills.length ? [createLoadSkillTool(skills) as NovaTool<never>] : []),
        ...(interaction ? createInteractionTools(interaction) : []),
        ...(memory?.isEnabled() ? createMemoryTools(memory) : []),
        ...(subagents ? [createSubagentTool(subagents)] : []),
        ...(codingAgents ? [createCodingAgentTool(codingAgents)] : [])
    ];
    const ownMcp = mcpService?.tools() ?? [];
    const toAvailable = (tool: NovaTool<never>, mcp: boolean): AvailableTool => ({
        info: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, tags: [] } as vscode.LanguageModelToolInformation,
        readOnly: tool.readOnly,
        nova: tool,
        mcp
    });
    const builtIn = [
        ...novaTools.map((tool) => toAvailable(tool, false)),
        ...ownMcp.map((entry) => toAvailable(createMcpTool(entry, mcpService!) as NovaTool<never>, true))
    ];

    // VS Code names MCP tools `mcp_<server>_<tool>`; skip those of servers Nova connects itself.
    const ownServers = new Set(ownMcp.map((entry) => `mcp_${entry.server.replace(/[^a-zA-Z0-9_-]/g, '_')}_`));
    const includeMcp = vscode.workspace.getConfiguration('nova').get<boolean>('agent.includeMcpTools', true);
    const vscodeMcp = includeMcp
        ? vscode.lm.tools
            .filter((tool) => tool.name.startsWith('mcp_') && ![...ownServers].some((prefix) => tool.name.startsWith(prefix)))
            .map((info) => ({ info, readOnly: false, mcp: true }))
        : [];
    return [...builtIn, ...vscodeMcp];
}

function toModelOption(model: LanguageModelInfo): ChatModelOption {
    const efforts = effortsOf(model);
    const description = typeof model.raw?.description === 'string' ? model.raw.description.trim() : '';
    const thinkingSwitch = efforts.length > 0 && !model.raw?.reasoning_efforts?.length;
    return { id: model.id, name: model.name, maxInputTokens: model.maxInputTokens, ...(efforts.length ? { efforts } : {}), ...(thinkingSwitch ? { thinkingSwitch } : {}), ...(description ? { description } : {}) };
}

/** Levels the gateway lists in `reasoning_efforts`; a model that can think but lists none gets an Off / On switch ("medium" stands for any level other than "none"). */
function effortsOf(model: LanguageModelInfo | undefined): string[] {
    const listed = model?.raw?.reasoning_efforts ?? [];
    return !listed.length && model?.raw?.capabilities?.includes('reasoning') ? ['none', 'medium'] : listed;
}

function getApprovalMode(): ApprovalMode {
    const mode = vscode.workspace.getConfiguration('nova').get<string>('agent.approvalMode', 'autoReadOnly');
    return mode === 'ask' || mode === 'autoAll' ? mode : 'autoReadOnly';
}

/** The call's subject for permission rules: the command, URL or path it acts on. */
async function createSystemMessage(memory?: MemoryService, skills?: string, agent?: string, subagents?: { maxPerCall: number; maxParallel: number; maxTotal: number }): Promise<vscode.LanguageModelChatMessage> {
    const prompt = createPanelPrompt({
        folders: workspaceFolders().map((folder) => folder.name),
        platform: process.platform,
        shell: vscode.env.shell || undefined,
        scratch: getScratchRoot(),
        memory: memory?.isEnabled() ? await memory.promptSection().catch(() => '') : undefined,
        skills,
        agent: agent || undefined,
        subagents
    });
    const systemRole = getSystemRole();
    return systemRole !== undefined
        ? new vscode.LanguageModelChatMessage(systemRole, prompt)
        : vscode.LanguageModelChatMessage.User(prompt);
}

/** Said in the prompt for each attached file that is not text or an image. */
const BINARY_ATTACHMENT_HINT = 'This file is not shown here. Open it with your tools and decide what to extract. For a PDF, Word, Excel or PowerPoint file, load the matching skill with load_skill (nova-pdf, nova-docx, nova-xlsx or nova-pptx); they read, create and edit these files. For anything else, use run_command (python, unzip, …).';

async function buildPrompt(prompt: string, attachments: readonly Attachment[]): Promise<Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart>> {
    const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];
    const blocks: string[] = [];
    for (const attachment of attachments) {
        if (attachment.image) {
            const data = Uint8Array.from(atob(attachment.image.data), (character) => character.charCodeAt(0));
            parts.push(new vscode.LanguageModelDataPart(data, attachment.image.mimeType));
            if (attachment.path) {
                blocks.push(`<attachment path="${attachment.label}" type="image" />`);
            }
            continue;
        }
        if (attachment.binary && attachment.path) {
            const scratch = getScratchRoot();
            const absolute = scratch && attachment.path.startsWith('scratch/') ? nodePath.join(scratch, attachment.path.slice('scratch/'.length)) : undefined;
            blocks.push(`<attachment path="${attachment.path}" type="file" size="${attachment.binary.size}"${absolute ? ` absolutePath="${absolute}"` : ''}>\n${BINARY_ATTACHMENT_HINT}\n</attachment>`);
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
