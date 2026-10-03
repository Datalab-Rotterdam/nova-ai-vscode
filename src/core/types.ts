import type { ModelResponse } from '@datalabrotterdam/nova-sdk';

export type ToolCallingSupport = 'unknown' | 'supported' | 'unsupported';
export type ConnectionHealth = 'signedOut' | 'connected' | 'degraded';

export interface AccountSummary {
  providerNames: string[];
  modelCount: number;
  validatedAt: string;
  baseUrl: string;
  /** The signed-in user, once the Nova API reports it. */
  profile?: UserProfile;
}

export interface UserProfile {
  name?: string;
  email?: string;
  /** http(s) URL of the profile picture. */
  avatarUrl?: string;
}

/** What the webview shows for the user: a picture, else initials, else an icon. */
export interface ProfileView {
  name?: string;
  email?: string;
  initials?: string;
  /** Picture as a data: URI, so the webview needs no remote image access. */
  avatar?: string;
}

export interface SessionSnapshot {
  hasApiKey: boolean;
  connectionHealth: ConnectionHealth;
  lastError?: string;
  accountSummary?: AccountSummary;
  selectedModelId?: string;
  toolCallingSupport: ToolCallingSupport;
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
  isDefault: boolean;
  isUserSelectable: boolean;
  maxContextWindowTokens?: number;
  pricing?: string;
  configurationSchema?: {
    properties?: Record<string, Record<string, unknown>>;
  };
  capabilities: {
    imageInput?: boolean;
    toolCalling?: boolean | number;
    editTools?: string[];
  };
}> {
  readonly raw: ModelResponse;
}

