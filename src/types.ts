import type { ModelResponse } from '@datalabrotterdam/nova-sdk';

export type ToolCallingSupport = 'unknown' | 'supported' | 'unsupported';
export type ConnectionHealth = 'signedOut' | 'connected' | 'degraded';

export interface NovaAccountSummary {
  providerNames: string[];
  modelCount: number;
  validatedAt: string;
  baseUrl: string;
}

export interface NovaSessionSnapshot {
  hasApiKey: boolean;
  connectionHealth: ConnectionHealth;
  lastError?: string;
  accountSummary?: NovaAccountSummary;
  selectedModelId?: string;
  toolCallingSupport: ToolCallingSupport;
}

export interface NovaLanguageModelInfo extends Readonly<{
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

