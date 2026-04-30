import './app.scss';
import { mount } from 'svelte';
// @ts-ignore
import App from './App.svelte';
import type { SidebarRenderState, VsCodeApi } from './types';

const initialState: SidebarRenderState = window.__NOVA_SIDEBAR_STATE__ ?? {
  snapshot: {
    hasApiKey: false,
    connectionHealth: 'signedOut',
    toolCallingSupport: 'unknown'
  },
  availableModels: [],
  chat: {
    messages: [],
    isResponding: false,
    availableTools: [],
    activeChatId: 'chat-new',
    activeThinkingId: undefined,
    activeToolId: undefined,
    history: [],
    activeMode: 'agent',
    activeApprovalPolicy: 'safeOnly',
    activeEnvironmentScope: 'local',
    customAgents: []
  }
};

const vscode = window.acquireVsCodeApi?.() as VsCodeApi | undefined;
const target = document.getElementById('app')!;
target.replaceChildren();

const app = mount(App, {
  target,
  props: {
    initialState,
    vscode
  }
});

export default app;
