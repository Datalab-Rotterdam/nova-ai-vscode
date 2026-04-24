<script lang="ts">
  import { COMMAND_OPEN_CHAT, COMMAND_REFRESH_MODELS, COMMAND_SIGN_OUT } from '../../../src/constants';
  import type { SidebarRenderState, ThemeMode, VsCodeApi } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let vscode: VsCodeApi | undefined;

  const validatedAt = state.snapshot.accountSummary?.validatedAt
    ? new Date(state.snapshot.accountSummary.validatedAt).toLocaleString()
    : 'Not validated yet';

  const healthLabel = state.snapshot.connectionHealth === 'connected'
    ? 'Healthy'
    : state.snapshot.connectionHealth === 'degraded'
      ? 'Attention needed'
      : 'Signed out';

  function sendCommand(command: string) {
    vscode?.postMessage({ command });
  }
</script>

<section class="card" data-theme={theme}>
  <div class={`status ${state.snapshot.connectionHealth}`}>
    <span>{healthLabel}</span>
    <span>{validatedAt}</span>
  </div>

  <h2>Account</h2>
  <p>{state.snapshot.accountSummary?.providerNames.join(', ') || 'Nova runtime'}</p>
  <p>{state.snapshot.accountSummary?.modelCount ?? 0} models available</p>
  <p>Preferred model: {state.preferredModel?.name ?? state.snapshot.selectedModelId ?? 'Not selected'}</p>

  <div class="actions">
    <button onclick={() => sendCommand(COMMAND_OPEN_CHAT)}>Open Chat</button>
    <button onclick={() => sendCommand(COMMAND_REFRESH_MODELS)}>Refresh Models</button>
    <button class="secondary" onclick={() => sendCommand(COMMAND_SIGN_OUT)}>Sign Out</button>
  </div>
</section>

