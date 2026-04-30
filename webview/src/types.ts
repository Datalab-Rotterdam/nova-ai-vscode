import type { ChatRenderState } from '../../src/chat/ChatService';
import type { LanguageModelInfo, SessionSnapshot } from '../../src/core/types';

export interface SidebarRenderState {
  snapshot: SessionSnapshot;
  preferredModel?: LanguageModelInfo;
  availableModels?: readonly LanguageModelInfo[];
  logoUri?: string;
  backgroundVideoUri?: string;
  chat?: ChatRenderState;
}

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export type SidebarView = 'welcome' | 'apiKey' | 'main';

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
}

export interface HostStateMessage {
  type: 'state';
  state: SidebarRenderState;
}

declare global {
  interface Window {
    __NOVA_SIDEBAR_STATE__?: SidebarRenderState;
    acquireVsCodeApi?: () => VsCodeApi;
  }
}
