import * as vscode from 'vscode';
import {
  STATE_CHAT_HISTORY
} from '../core/constants';
import type {
  ChatApprovalPolicy,
  ChatEnvironmentScope,
  ChatMode
} from '../core/types';

export interface StoredRequestRecord {
  prompt: string;
  submittedAt: string;
}

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'status';
  text: string;
  status?: 'running' | 'done' | 'error';
  name?: string;
  pending?: boolean;
  markdown?: boolean;
  details?: string;
  inputText?: string;
  meta?: string;
  error?: boolean;
}

export interface StoredChatSession {
  id: string;
  version: 2;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  preview: string;
  selectedModelId?: string;
  mode: ChatMode;
  customAgentId?: string;
  environmentScope: ChatEnvironmentScope;
  approvalPolicy: ChatApprovalPolicy;
  transcript: StoredChatMessage[];
  requestHistory: StoredRequestRecord[];
  messages: Array<Record<string, unknown>>;
}

interface StoredChatState {
  version: 2;
  activeChatId?: string;
  sessions: StoredChatSession[];
}

interface LegacyChatRecord {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt: string;
  preview: string;
  modelId?: string;
  messages: Array<Record<string, unknown>>;
  render: StoredChatMessage[];
}

const CURRENT_VERSION = 2 as const;
const MAX_SAVED_CHATS = 50;

export class SessionStore {
  public constructor(
    private readonly globalState: Pick<vscode.Memento, 'get' | 'update'>
  ) {
  }

  public async load(): Promise<StoredChatState> {
    const stored = this.globalState.get<StoredChatState | LegacyChatRecord[]>(STATE_CHAT_HISTORY);
    if (!stored) {
      return {
        version: CURRENT_VERSION,
        sessions: []
      };
    }

    if (Array.isArray(stored)) {
      return {
        version: CURRENT_VERSION,
        activeChatId: stored[0]?.id,
        sessions: stored
          .filter(isLegacyChatRecord)
          .map(migrateLegacyRecord)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      };
    }

    if (stored.version === CURRENT_VERSION && Array.isArray(stored.sessions)) {
      return {
        version: CURRENT_VERSION,
        activeChatId: typeof stored.activeChatId === 'string' ? stored.activeChatId : stored.sessions[0]?.id,
        sessions: stored.sessions.filter(isStoredChatSession)
      };
    }

    return {
      version: CURRENT_VERSION,
      sessions: []
    };
  }

  public async save(state: StoredChatState): Promise<void> {
    await this.globalState.update(STATE_CHAT_HISTORY, {
      version: CURRENT_VERSION,
      activeChatId: state.activeChatId,
      sessions: state.sessions
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_SAVED_CHATS)
    });
  }
}

function migrateLegacyRecord(record: LegacyChatRecord): StoredChatSession {
  return {
    id: record.id,
    version: CURRENT_VERSION,
    title: record.title,
    createdAt: record.createdAt ?? record.updatedAt,
    updatedAt: record.updatedAt,
    archived: false,
    preview: record.preview,
    selectedModelId: record.modelId,
    mode: 'agent',
    environmentScope: 'local',
    approvalPolicy: 'safeOnly',
    transcript: record.render,
    requestHistory: [],
    messages: record.messages
  };
}

function isLegacyChatRecord(value: unknown): value is LegacyChatRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.messages)
    && Array.isArray(value.render);
}

function isStoredChatSession(value: unknown): value is StoredChatSession {
  return isRecord(value)
    && value.version === CURRENT_VERSION
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.archived === 'boolean'
    && Array.isArray(value.transcript)
    && Array.isArray(value.messages)
    && Array.isArray(value.requestHistory)
    && (value.mode === 'agent' || value.mode === 'ask' || value.mode === 'plan')
    && (value.environmentScope === 'local' || value.environmentScope === 'chatOnly')
    && (value.approvalPolicy === 'always' || value.approvalPolicy === 'safeOnly' || value.approvalPolicy === 'neverForSafe');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
