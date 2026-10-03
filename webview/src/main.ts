import '@vscode/codicons/dist/codicon.css';
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
  }
};

// The editor tab uses the editor's colors instead of the sidebar's.
document.documentElement.dataset.surface = initialState.surface ?? 'sidebar';

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
