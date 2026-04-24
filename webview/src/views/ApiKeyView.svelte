<script lang="ts">
  import arrowLeftIcon from 'bootstrap-icons/icons/arrow-left.svg?raw';
  import boxArrowUpRightIcon from 'bootstrap-icons/icons/box-arrow-up-right.svg?raw';
  import infoCircleIcon from 'bootstrap-icons/icons/info-circle.svg?raw';
  import { COMMAND_SIGN_IN } from '../../../src/constants';
  import type { SidebarRenderState, ThemeMode, VsCodeApi } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let vscode: VsCodeApi | undefined;
  export let onBack: () => void;

  let apiKey = '';

  const apiKeyUrl = 'https://platform.nova.datalabrotterdam.nl/dashboard/api-keys?name=Nova%20AI%20VSCode%20Extensie&scopes=models:read,llm:call';
  const docsUrl = 'https://docs.datalabrotterdam.nl/services/nova-ai';

  function connect() {
    vscode?.postMessage({
      command: COMMAND_SIGN_IN,
      apiKey
    });
  }
</script>

<section class="api-key-page" data-theme={theme}>
  <form class="connect-panel" onsubmit={(event) => { event.preventDefault(); connect(); }}>
    <button class="back-button" type="button" aria-label="Back" title="Back" onclick={onBack}>
      <span aria-hidden="true">{@html arrowLeftIcon}</span>
      Back
    </button>

    <div class="connect-copy">
      <p class="form-title">Create your Nova API key</p>
      <p>Generate a key with model read and LLM call scopes, then paste it below.</p>
      <a class="docs-link" href={docsUrl} target="_blank" rel="noreferrer" title="Open Nova AI documentation">
        <span aria-hidden="true">{@html infoCircleIcon}</span>
        Nova AI documentation
      </a>
    </div>

    <a class="api-key-link" href={apiKeyUrl} target="_blank" rel="noreferrer">
      Create API key
      <span aria-hidden="true">{@html boxArrowUpRightIcon}</span>
    </a>

    {#if state.snapshot.lastError}
      <p class="error">{state.snapshot.lastError}</p>
    {/if}

    <label for="apiKey">API key</label>
    <input id="apiKey" type="password" bind:value={apiKey} placeholder="sk_live..." autocomplete="off" spellcheck="false" />

    <button class="connect-button" type="submit">Connect</button>
  </form>
</section>

<style lang="scss">
  .api-key-page {
    min-height: 100vh;
    display: grid;
    align-items: center;
    padding: 12px;
    box-sizing: border-box;
    background: var(--bg);
  }

  .connect-panel {
    width: 100%;
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--input-bg) 82%, var(--bg));
    box-sizing: border-box;
  }

  .back-button {
    width: max-content;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    background: transparent;
    color: var(--fg);

    :global(svg) {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }

    &:hover {
      background: var(--row-hover);
    }
  }

  .connect-copy {
    display: grid;
    gap: 8px;
  }

  p {
    margin: 0;
  }

  .form-title {
    color: var(--fg);
    font-size: 19px;
    font-weight: 650;
    line-height: 1.25;
  }

  p,
  label {
    color: var(--muted);
  }

  .docs-link {
    width: max-content;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
    text-decoration: none;

    :global(svg) {
      width: 13px;
      height: 13px;
      fill: currentColor;
    }

    &:hover {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
    }
  }

  .api-key-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--secondary-bg);
    color: var(--secondary-fg);
    box-sizing: border-box;
    font-weight: 650;
    text-decoration: none;

    :global(svg) {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  }

  .error {
    color: var(--danger);
  }

  input {
    padding: 10px 12px;
    background: var(--input-bg);
    color: var(--input-fg);
    border-color: var(--input-border);
  }

  .connect-button {
    padding: 10px 12px;
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 650;
  }
</style>
