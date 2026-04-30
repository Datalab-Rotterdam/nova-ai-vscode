import * as vscode from 'vscode';
import type {
  ChatCompletionRequest,
  ChatCompletionUsage,
  ChatMessage
} from '@datalabrotterdam/nova-sdk';
import { getCustomAgents } from '../core/config';
import { Diagnostics } from '../core/diagnostics';
import { mapNovaError } from '../core/errors';
import type {
  ChatApprovalPolicy,
  ChatEnvironmentScope,
  ChatMode,
  CustomAgentDefinition,
  LanguageModelInfo
} from '../core/types';
import { SessionService } from '../services/SessionService';
import {
  SessionStore,
  type StoredChatMessage,
  type StoredChatSession
} from './SessionStore';

export interface ChatHistoryItem {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  modelId?: string;
  archived: boolean;
}

export interface ChatRenderMessage extends StoredChatMessage {}

export interface ChatRenderState {
  messages: ChatRenderMessage[];
  isResponding: boolean;
  availableTools: string[];
  activeChatId: string;
  activeThinkingId?: string;
  activeToolId?: string;
  history: ChatHistoryItem[];
  activeMode: ChatMode;
  activeCustomAgentId?: string;
  activeApprovalPolicy: ChatApprovalPolicy;
  activeEnvironmentScope: ChatEnvironmentScope;
  customAgents: CustomAgentDefinition[];
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

interface ActiveSessionState {
  messages: ChatMessage[];
  session: StoredChatSession;
}

const SAFE_TOOL_PREFIX = 'nova_';
const MAX_TOOL_ROUNDS = 6;

export class ChatService {
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeState = this.didChangeStateEmitter.event;
  private readonly store: SessionStore;
  private sessions: StoredChatSession[] = [];
  private active?: ActiveSessionState;
  private isResponding = false;

  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'globalState'>,
    private readonly sessionService: SessionService,
    private readonly diagnostics: Diagnostics
  ) {
    this.store = new SessionStore(context.globalState);
  }

  public async initialize(): Promise<void> {
    const state = await this.store.load();
    this.sessions = state.sessions;
    const activeSession = this.sessions.find((item) => item.id === state.activeChatId) ?? this.sessions[0];
    this.active = activeSession
      ? toActiveState(activeSession)
      : createActiveState();
  }

  public getRenderState(): ChatRenderState {
    const active = this.ensureActive();
    const customAgents = getCustomAgents();

    return {
      messages: active.session.transcript,
      isResponding: this.isResponding,
      availableTools: this.getSelectableTools(active.session).map((tool) => tool.name),
      activeChatId: active.session.id,
      activeThinkingId: findLastMessage(active.session.transcript, (message) => message.role === 'thinking' && message.status === 'running')?.id,
      activeToolId: findLastMessage(active.session.transcript, (message) => message.role === 'tool' && message.status === 'running')?.id,
      history: this.sessions.map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        preview: item.preview,
        modelId: item.selectedModelId,
        archived: item.archived
      })),
      activeMode: active.session.mode,
      activeCustomAgentId: active.session.customAgentId,
      activeApprovalPolicy: active.session.approvalPolicy,
      activeEnvironmentScope: active.session.environmentScope,
      customAgents
    };
  }

  public async createSession(): Promise<void> {
    await this.persistActiveSession();
    this.active = createActiveState();
    await this.saveSessions();
    this.fireDidChange();
  }

  public async clear(): Promise<void> {
    await this.createSession();
  }

  public async switchChat(id: string): Promise<void> {
    await this.persistActiveSession();
    const session = this.sessions.find((item) => item.id === id);
    if (!session) {
      return;
    }

    this.active = toActiveState(session);
    this.fireDidChange();
  }

  public async renameSession(id: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) {
      return;
    }

    const value = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: 'Rename chat',
      value: session.title
    });
    if (!value?.trim()) {
      return;
    }

    session.title = value.trim();
    session.updatedAt = new Date().toISOString();
    if (this.active?.session.id === id) {
      this.active.session.title = session.title;
      this.active.session.updatedAt = session.updatedAt;
    }
    await this.saveSessions();
    this.fireDidChange();
  }

  public async archiveSession(id: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) {
      return;
    }

    session.archived = true;
    session.updatedAt = new Date().toISOString();
    if (this.active?.session.id === id) {
      await this.createSession();
      return;
    }

    await this.saveSessions();
    this.fireDidChange();
  }

  public async deleteSession(id: string): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      'Delete this Nova chat session permanently?',
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') {
      return;
    }

    this.sessions = this.sessions.filter((item) => item.id !== id);
    if (this.active?.session.id === id) {
      this.active = this.sessions[0] ? toActiveState(this.sessions[0]) : createActiveState();
    }

    await this.saveSessions();
    this.fireDidChange();
  }

  public async selectMode(mode: ChatMode): Promise<void> {
    const active = this.ensureActive();
    active.session.mode = mode;
    active.session.environmentScope = mode === 'agent'
      ? this.defaultEnvironmentScopeFor(active.session)
      : 'chatOnly';
    active.session.updatedAt = new Date().toISOString();
    await this.persistActiveSession();
    this.fireDidChange();
  }

  public async selectCustomAgent(agentId?: string): Promise<void> {
    const active = this.ensureActive();
    active.session.customAgentId = agentId;
    const agent = getCustomAgents().find((item) => item.id === agentId);
    if (agent?.mode) {
      active.session.mode = agent.mode;
    }
    if (agent?.defaultModelId) {
      active.session.selectedModelId = agent.defaultModelId;
    }
    active.session.environmentScope = active.session.mode === 'agent'
      ? this.defaultEnvironmentScopeFor(active.session)
      : 'chatOnly';
    active.session.updatedAt = new Date().toISOString();
    await this.persistActiveSession();
    this.fireDidChange();
  }

  public async selectApprovalPolicy(policy: ChatApprovalPolicy): Promise<void> {
    const active = this.ensureActive();
    active.session.approvalPolicy = policy;
    active.session.updatedAt = new Date().toISOString();
    await this.persistActiveSession();
    this.fireDidChange();
  }

  public async selectEnvironmentScope(scope: ChatEnvironmentScope): Promise<void> {
    const active = this.ensureActive();
    active.session.environmentScope = scope;
    active.session.updatedAt = new Date().toISOString();
    await this.persistActiveSession();
    this.fireDidChange();
  }

  public async selectModel(modelId: string): Promise<void> {
    const active = this.ensureActive();
    active.session.selectedModelId = modelId;
    active.session.updatedAt = new Date().toISOString();
    await this.persistActiveSession();
    this.fireDidChange();
  }

  public async submit(prompt: string, model: LanguageModelInfo): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || this.isResponding) {
      return;
    }

    const client = await this.sessionService.createClient();
    if (!client) {
      throw new Error('Connect Nova AI before sending chat messages.');
    }

    const active = this.ensureActive();
    await this.performSubmit(active, trimmedPrompt, model, client);
  }

  public async editAndResubmit(messageId: string, prompt: string, model: LanguageModelInfo): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || this.isResponding) {
      return;
    }

    const client = await this.sessionService.createClient();
    if (!client) {
      throw new Error('Connect Nova AI before sending chat messages.');
    }

    const active = this.ensureActive();
    const transcriptIndex = active.session.transcript.findIndex((message) => message.id === messageId && message.role === 'user');
    if (transcriptIndex === -1) {
      throw new Error('Could not find the selected user message to edit.');
    }

    const activeMessageIndex = mapTranscriptMessageToActiveIndex(active.session.transcript, messageId);
    if (activeMessageIndex === -1) {
      throw new Error('Could not align the selected user message with the chat history.');
    }

    const userTurnIndex = countUserTurnsBefore(active.session.transcript, transcriptIndex);
    active.session.transcript = active.session.transcript.slice(0, transcriptIndex);
    active.session.requestHistory = active.session.requestHistory.slice(0, userTurnIndex);
    active.messages = active.messages.slice(0, activeMessageIndex);

    await this.performSubmit(active, trimmedPrompt, model, client);
  }

  private async performSubmit(
    active: ActiveSessionState,
    trimmedPrompt: string,
    model: LanguageModelInfo,
    client: NonNullable<Awaited<ReturnType<SessionService['createClient']>>>
  ): Promise<void> {
    this.isResponding = true;
    active.session.selectedModelId = model.id;
    active.messages = [...active.messages, { role: 'user', content: trimmedPrompt }];
    active.session.requestHistory.push({ prompt: trimmedPrompt, submittedAt: new Date().toISOString() });
    active.session.transcript = [
      ...active.session.transcript,
      { id: createId('user'), role: 'user', text: trimmedPrompt },
      { id: createId('thinking'), role: 'thinking', text: 'Thinking', pending: true, status: 'running' }
    ];
    this.fireDidChange();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const turn = await this.runAssistantTurn(client, model, active);
        active.messages = [...active.messages, turn.message];

        if (!turn.toolCalls.length) {
          break;
        }

        const toolMessages = await this.invokeToolCalls(turn.toolCalls, active);
        active.messages = [...active.messages, ...toolMessages];
      }
    } catch (error) {
      const mapped = mapNovaError(error);
      active.session.transcript = [
        ...active.session.transcript,
        { id: createId('status'), role: 'status', text: mapped.message, error: true }
      ];
      this.diagnostics.error('Nova chat request failed.', error);
      throw error;
    } finally {
      this.isResponding = false;
      active.session.transcript = active.session.transcript.map((message) => (
        message.pending
          ? { ...message, pending: false, status: message.error ? 'error' : 'done' }
          : message
      ));
      this.touchSession(active.session);
      await this.persistActiveSession();
      this.fireDidChange();
    }
  }

  private async runAssistantTurn(
    client: NonNullable<Awaited<ReturnType<SessionService['createClient']>>>,
    model: LanguageModelInfo,
    active: ActiveSessionState
  ): Promise<{ message: ChatMessage; toolCalls: Array<Record<string, unknown>> }> {
    const tools = supportsToolCalling(model)
      ? this.getSelectableTools(active.session)
      : [];
    const request: ChatCompletionRequest & Record<string, unknown> = {
      model: model.id,
      messages: this.buildRequestMessages(active.messages, active.session),
      max_tokens: model.maxOutputTokens,
      ...(tools.length ? {
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? { type: 'object', properties: {} }
          }
        })),
        tool_choice: 'auto'
      } : {})
    };

    let assistantText = '';
    let thinkingText = '';
    let finalUsage: ChatCompletionUsage | undefined;
    const pendingToolCalls = new Map<number, PendingToolCall>();

    for await (const event of client.chat.completions.stream(request)) {
      if (event.type !== 'chunk') {
        continue;
      }

      finalUsage = event.data.usage ?? finalUsage;
      for (const choice of event.data.choices ?? []) {
        const content = choice.delta?.content;
        if (typeof content === 'string' && content.length) {
          assistantText += content;
          this.upsertPendingAssistant(active, assistantText);
        }

        const reasoning = extractReasoning(choice.delta as Record<string, unknown> | undefined);
        if (reasoning) {
          thinkingText += reasoning;
          this.upsertPendingThinking(active, thinkingText);
        }

        const toolCalls = Array.isArray((choice.delta as Record<string, unknown>)?.tool_calls)
          ? ((choice.delta as Record<string, unknown>).tool_calls as Array<Record<string, unknown>>)
          : [];

        for (const toolCall of toolCalls) {
          const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
          const current = pendingToolCalls.get(index) ?? {
            id: typeof toolCall.id === 'string' ? toolCall.id : `nova-tool-${index}`,
            name: '',
            argumentsText: ''
          };
          const fn = asRecord(toolCall.function);
          if (fn && typeof fn.name === 'string') {
            current.name = fn.name;
          }
          if (fn && typeof fn.arguments === 'string') {
            current.argumentsText += fn.arguments;
          }
          pendingToolCalls.set(index, current);
        }
      }
    }

    this.finishAssistantTurn(active, thinkingText, finalUsage);
    const assistantToolCalls = Array.from(pendingToolCalls.values()).map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: toolCall.argumentsText || '{}'
      }
    }));

    return {
      message: {
        role: 'assistant',
        content: assistantText,
        ...(assistantToolCalls.length ? { tool_calls: assistantToolCalls } : {})
      },
      toolCalls: assistantToolCalls
    };
  }

  private async invokeToolCalls(
    toolCalls: Array<Record<string, unknown>>,
    active: ActiveSessionState
  ): Promise<ChatMessage[]> {
    const toolMessages: ChatMessage[] = [];

    for (const toolCall of toolCalls) {
      const fn = asRecord(toolCall.function);
      const toolName = typeof fn?.name === 'string' ? fn.name : 'tool';
      const toolCallId = typeof toolCall.id === 'string' ? toolCall.id : createId('tool-call');
      const input = parseToolInput(fn?.arguments);
      const messageId = createId('tool');
      active.session.transcript = [
        ...active.session.transcript,
        {
          id: messageId,
          role: 'tool',
          name: toolName,
          text: toolName,
          inputText: safeStringify(input),
          pending: true,
          status: 'running'
        }
      ];
      this.fireDidChange();

      const allowed = await this.confirmToolInvocation(toolName, active.session.approvalPolicy);
      if (!allowed) {
        const cancelledMessage = 'Tool invocation was cancelled by the user.';
        active.session.transcript = replaceMessage(active.session.transcript, messageId, {
          details: cancelledMessage,
          pending: false,
          error: true,
          status: 'error'
        });
        toolMessages.push({ role: 'tool', tool_call_id: toolCallId, content: cancelledMessage });
        continue;
      }

      try {
        const result = await vscode.lm.invokeTool(toolName, { toolInvocationToken: undefined, input });
        const output = toolResultToString(result);
        active.session.transcript = replaceMessage(active.session.transcript, messageId, {
          details: output,
          pending: false,
          status: 'done'
        });
        toolMessages.push({ role: 'tool', tool_call_id: toolCallId, content: output });
      } catch (error) {
        const output = error instanceof Error ? error.message : 'Tool invocation failed.';
        active.session.transcript = replaceMessage(active.session.transcript, messageId, {
          details: output,
          pending: false,
          error: true,
          status: 'error'
        });
        toolMessages.push({ role: 'tool', tool_call_id: toolCallId, content: output });
      }
    }

    return toolMessages;
  }

  private buildRequestMessages(messages: ChatMessage[], session: StoredChatSession): ChatMessage[] {
    const agent = getCustomAgents().find((item) => item.id === session.customAgentId);
    const systemParts: string[] = [];
    if (session.mode === 'ask') {
      systemParts.push('You are Nova in Ask mode. Answer directly and concisely. Do not request or call tools.');
    } else if (session.mode === 'plan') {
      systemParts.push('You are Nova in Plan mode. Produce implementation plans and reasoning in markdown. Do not call tools.');
    } else {
      systemParts.push('You are Nova in Agent mode. Use tools when helpful and keep the user informed through concise markdown.');
    }
    if (agent?.systemPrompt) {
      systemParts.push(agent.systemPrompt);
    }

    return systemParts.length
      ? [{ role: 'system', content: systemParts.join('\n\n') }, ...messages]
      : messages;
  }

  private getSelectableTools(session: StoredChatSession): readonly vscode.LanguageModelToolInformation[] {
    if (session.mode !== 'agent' || session.environmentScope !== 'local') {
      return [];
    }

    const agent = getCustomAgents().find((item) => item.id === session.customAgentId);
    if (agent?.toolsEnabled === false) {
      return [];
    }

    return vscode.lm.tools;
  }

  private async confirmToolInvocation(toolName: string, policy: ChatApprovalPolicy): Promise<boolean> {
    const safe = isSafeTool(toolName);
    if (policy === 'always') {
      return requestConfirmation(toolName);
    }
    if (policy === 'safeOnly') {
      return safe ? true : requestConfirmation(toolName);
    }
    return true;
  }

  private upsertPendingAssistant(active: ActiveSessionState, text: string): void {
    const existing = findLastMessage(active.session.transcript, (message) => message.role === 'assistant' && !!message.pending);
    if (existing) {
      existing.text = text;
      existing.markdown = true;
    } else {
      active.session.transcript.push({
        id: createId('assistant'),
        role: 'assistant',
        text,
        markdown: true,
        pending: true,
        status: 'running'
      });
    }
    this.fireDidChange();
  }

  private upsertPendingThinking(active: ActiveSessionState, details: string): void {
    const existing = findLastMessage(active.session.transcript, (message) => message.role === 'thinking' && !!message.pending);
    if (existing) {
      existing.text = 'Thinking';
      existing.details = details;
    } else {
      active.session.transcript.push({
        id: createId('thinking'),
        role: 'thinking',
        text: 'Thinking',
        details,
        pending: true,
        status: 'running'
      });
    }
    this.fireDidChange();
  }

  private finishAssistantTurn(active: ActiveSessionState, thinkingText: string, usage?: ChatCompletionUsage): void {
    const usageLabel = createUsageLabel(usage);
    if (!thinkingText) {
      active.session.transcript = active.session.transcript.filter((message) => !(message.role === 'thinking' && message.pending));
    } else {
      active.session.transcript = active.session.transcript.map((message) =>
        message.role === 'thinking' && message.pending
          ? { ...message, pending: false, status: message.error ? 'error' : 'done', meta: usageLabel, details: thinkingText.trim() }
          : message
      );
    }

    const assistant = findLastMessage(active.session.transcript, (message) => message.role === 'assistant' && !!message.pending);
    if (assistant && usageLabel) {
      assistant.meta = usageLabel;
      assistant.pending = false;
      assistant.status = assistant.error ? 'error' : 'done';
    }
  }

  private touchSession(session: StoredChatSession): void {
    session.updatedAt = new Date().toISOString();
    session.title = deriveTitle(session);
    session.preview = derivePreview(session);
  }

  private ensureActive(): ActiveSessionState {
    if (!this.active) {
      this.active = createActiveState();
    }
    return this.active;
  }

  private async persistActiveSession(): Promise<void> {
    const active = this.ensureActive();
    if (!active.session.transcript.length) {
      this.sessions = this.sessions.filter((item) => item.id !== active.session.id);
      await this.saveSessions();
      return;
    }

    this.touchSession(active.session);
    active.session.messages = structuredClone(active.messages as Array<Record<string, unknown>>);
    const next = active.session;
    this.sessions = [
      next,
      ...this.sessions.filter((item) => item.id !== next.id)
    ];
    await this.saveSessions();
  }

  private defaultEnvironmentScopeFor(session: StoredChatSession): ChatEnvironmentScope {
    const agent = getCustomAgents().find((item) => item.id === session.customAgentId);
    if (session.mode !== 'agent' || agent?.toolsEnabled === false) {
      return 'chatOnly';
    }
    return 'local';
  }

  private async saveSessions(): Promise<void> {
    const activeId = this.active?.session.id;
    await this.store.save({
      version: 2,
      activeChatId: activeId,
      sessions: this.sessions
    });
  }

  private fireDidChange(): void {
    this.didChangeStateEmitter.fire();
  }
}

async function requestConfirmation(toolName: string): Promise<boolean> {
  const confirmed = await vscode.window.showWarningMessage(
    `Allow Nova AI to run the tool "${toolName}"?`,
    { modal: false },
    'Continue'
  );
  return confirmed === 'Continue';
}

function isSafeTool(toolName: string): boolean {
  return toolName.startsWith(SAFE_TOOL_PREFIX);
}

function supportsToolCalling(model: LanguageModelInfo): boolean {
  const capability = model.capabilities.toolCalling;
  return capability === undefined
    || capability === true
    || (typeof capability === 'number' && capability > 0);
}

function toActiveState(session: StoredChatSession): ActiveSessionState {
  return {
    session: structuredClone(session),
    messages: structuredClone(session.messages as ChatMessage[])
  };
}

function createActiveState(): ActiveSessionState {
  const now = new Date().toISOString();
  return {
    messages: [],
    session: {
      id: createId('chat'),
      version: 2,
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      archived: false,
      preview: '',
      mode: 'agent',
      environmentScope: 'local',
      approvalPolicy: 'safeOnly',
      transcript: [],
      requestHistory: [],
      messages: []
    }
  };
}

function replaceMessage(
  transcript: StoredChatMessage[],
  id: string,
  patch: Partial<StoredChatMessage>
): StoredChatMessage[] {
  return transcript.map((message) => message.id === id ? { ...message, ...patch } : message);
}

function createUsageLabel(usage?: ChatCompletionUsage): string | undefined {
  if (!usage) {
    return undefined;
  }
  const parts: string[] = [];
  if (typeof usage.total_tokens === 'number') {
    parts.push(`${usage.total_tokens.toLocaleString('en-US')} tokens`);
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === 'number' && reasoning > 0) {
    parts.push(`${reasoning.toLocaleString('en-US')} reasoning`);
  }
  return parts.join(' · ') || undefined;
}

function deriveTitle(session: StoredChatSession): string {
  const firstUser = session.transcript.find((message) => message.role === 'user' && message.text.trim());
  return firstUser?.text.trim().slice(0, 60) || session.title || 'New chat';
}

function derivePreview(session: StoredChatSession): string {
  const latest = [...session.transcript].reverse().find((message) =>
    (message.role === 'assistant' || message.role === 'user') && message.text.trim()
  );
  return latest?.text.trim().slice(0, 140) ?? '';
}

function extractReasoning(delta?: Record<string, unknown>): string {
  if (!delta) {
    return '';
  }
  for (const key of ['reasoning', 'reasoning_content', 'thinking', 'thinking_content']) {
    const value = delta[key];
    if (typeof value === 'string' && value.length) {
      return value;
    }
  }
  return '';
}

function parseToolInput(value: unknown): object {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return { raw: value };
  }
}

function toolResultToString(result: vscode.LanguageModelToolResult): string {
  return result.content.map((part) => {
    if (part instanceof vscode.LanguageModelTextPart) {
      return part.value;
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      return new TextDecoder().decode(part.data);
    }
    if (typeof part === 'string') {
      return part;
    }
    try {
      return JSON.stringify(part, null, 2);
    } catch {
      return String(part);
    }
  }).filter(Boolean).join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findLastMessage(
  transcript: StoredChatMessage[],
  predicate: (message: StoredChatMessage) => boolean
): StoredChatMessage | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (predicate(message)) {
      return message;
    }
  }
  return undefined;
}

function mapTranscriptMessageToActiveIndex(transcript: StoredChatMessage[], messageId: string): number {
  let activeIndex = 0;
  for (const message of transcript) {
    if (isConversationRole(message.role)) {
      if (message.id === messageId) {
        return activeIndex;
      }
      activeIndex += 1;
    }
  }
  return -1;
}

function countUserTurnsBefore(transcript: StoredChatMessage[], transcriptIndex: number): number {
  let count = 0;
  for (let index = 0; index < transcriptIndex; index += 1) {
    if (transcript[index]?.role === 'user') {
      count += 1;
    }
  }
  return count;
}

function isConversationRole(role: StoredChatMessage['role']): role is 'user' | 'assistant' | 'tool' {
  return role === 'user' || role === 'assistant' || role === 'tool';
}
