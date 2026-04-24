import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import type { SidebarRenderState, VsCodeApi } from './types';

const initialState: SidebarRenderState = window.__NOVA_SIDEBAR_STATE__ ?? {
  snapshot: {
    hasApiKey: false,
    connectionHealth: 'signedOut',
    toolCallingSupport: 'unknown'
  }
};

const vscode = window.acquireVsCodeApi?.() as VsCodeApi | undefined;

const app = mount(App, {
  target: document.getElementById('app')!,
  props: {
    initialState,
    vscode
  }
});

export default app;
