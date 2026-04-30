import type { ModelResponse } from '@datalabrotterdam/nova-sdk';

export type ToolCallingSupport = 'unknown' | 'supported' | 'unsupported';
export type ConnectionHealth = 'signedOut' | 'connected' | 'degraded';
export type ChatMode = 'agent' | 'ask' | 'plan';
export type ChatEnvironmentScope = 'local' | 'chatOnly';
export type ChatApprovalPolicy = 'always' | 'safeOnly' | 'neverForSafe';

export interface AccountSummary {
  providerNames: string[];
  modelCount: number;
  validatedAt: string;
  baseUrl: string;
}

export interface SessionSnapshot {
  hasApiKey: boolean;
  connectionHealth: ConnectionHealth;
  lastError?: string;
  accountSummary?: AccountSummary;
  selectedModelId?: string;
  toolCallingSupport: ToolCallingSupport;
}

export interface CustomAgentDefinition {
  id: string;
  label: string;
  description?: string;
  systemPrompt: string;
  defaultModelId?: string;
  mode?: ChatMode;
  toolsEnabled?: boolean;
}

export interface LanguageModelInfo extends Readonly<{
  id: string;
  name: string;
  family: string;
  version: string;
  tooltip?: string;
  detail?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: {
    imageInput?: boolean;
    toolCalling?: boolean | number;
  };
}> {
  readonly raw: ModelResponse;
}
