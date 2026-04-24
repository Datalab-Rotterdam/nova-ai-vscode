import type { NovaLanguageModelInfo, NovaSessionSnapshot } from '../../src/types';

export interface SidebarRenderState {
  snapshot: NovaSessionSnapshot;
  preferredModel?: NovaLanguageModelInfo;
  logoUri?: string;
  backgroundVideoUri?: string;
}

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export type SidebarView = 'welcome' | 'createApiKey' | 'account';

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
}

declare global {
  interface Window {
    __NOVA_SIDEBAR_STATE__?: SidebarRenderState;
    acquireVsCodeApi?: () => VsCodeApi;
  }
}
