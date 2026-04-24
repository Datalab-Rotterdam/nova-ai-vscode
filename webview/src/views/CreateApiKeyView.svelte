<script lang="ts">
  import { COMMAND_SIGN_IN } from '../../../src/constants';
  import type { SidebarRenderState, ThemeMode, VsCodeApi } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let vscode: VsCodeApi | undefined;
  export let onBack: () => void;

  let apiKey = '';

  const apiKeyUrl = 'https://platform.nova.datalabrotterdam.nl/dashboard/api-keys?name=Nova%20AI%20VSCode%20Extensie&scopes=models:read,llm:call';

  function connect() {
    vscode?.postMessage({
      command: COMMAND_SIGN_IN,
      apiKey
    });
  }
</script>

<section class="signed-out" data-theme={theme}>
  {#if state.backgroundVideoUri}
    <video class="background-video" src={state.backgroundVideoUri} autoplay muted loop playsinline aria-hidden="true"></video>
  {/if}

  <div class="video-scrim"></div>

  <div class="connect-panel">
    <button class="back-button" aria-label="Back" title="Back" onclick={onBack}>Back</button>

    <div class="connect-copy">
      <h2>Create your Nova API key</h2>
      <p>Generate a key with model read and LLM call scopes, then paste it below.</p>
    </div>

    <a class="api-key-link" href={apiKeyUrl} target="_blank" rel="noreferrer">Create API key</a>

    {#if state.snapshot.lastError}
      <p class="error">{state.snapshot.lastError}</p>
    {/if}

    <label for="apiKey">API key</label>
    <input id="apiKey" type="password" bind:value={apiKey} placeholder="nova_..." autocomplete="off" spellcheck="false" />

    <button onclick={connect}>Connect</button>
  </div>
</section>

