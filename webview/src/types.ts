import type { ProfileView, SessionSnapshot } from '../../src/core/types';

/** Mirrors `SidebarModel` in src/views/index.ts. */
export interface SidebarModel {
  id: string;
  name: string;
  detail?: string;
  contextWindow: number;
  toolCalling: boolean;
  imageInput: boolean;
  pricing?: string;
}

/** Mirrors `SidebarRenderState` in src/views/index.ts. */
export interface SidebarRenderState {
  snapshot: SessionSnapshot;
  profile?: ProfileView;
  surface?: 'sidebar' | 'editor';
  models?: SidebarModel[];
  preferredModelId?: string;
  logoUri?: string;
  datalabLogoUri?: string;
}

export type SidebarView = 'welcome' | 'apiKey' | 'chat' | 'account';

export type ExtensionMessage =
  | { type: 'state'; state: SidebarRenderState }
  | { type: 'signInResult'; ok: boolean; error?: string }
  | { type: 'ui'; action: 'history' | 'account' };

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
