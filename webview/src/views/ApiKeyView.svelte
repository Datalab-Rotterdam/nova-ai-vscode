<script lang="ts">
    let {busy, error, onConnect, onBack}: {
        busy: boolean;
        error?: string;
        onConnect: (apiKey: string) => void;
        onBack: () => void;
    } = $props();

    let apiKey = $state('');

    const apiKeyUrl = 'https://platform.nova.datalabrotterdam.nl/dashboard/api-keys?name=Nova%20AI%20VSCode%20Extensie&scopes=models:read,llm:call';
    const docsUrl = 'https://docs.datalabrotterdam.nl/services/nova-ai';

    function submit(event: SubmitEvent) {
        event.preventDefault();
        if (apiKey.trim() && !busy) {
            onConnect(apiKey.trim());
        }
    }
</script>

<section class="connect">
    <button class="back" type="button" onclick={onBack}>
        <span class="codicon codicon-arrow-left" aria-hidden="true"></span>Back
    </button>

    <header>
        <h1>Connect your API key</h1>
        <p>Nova needs a key with the <code>models:read</code> and <code>llm:call</code> scopes.</p>
    </header>

    <ol class="steps">
        <li>
            <span class="step">1</span>
            <div>
                <p>Create a key in the Nova platform.</p>
                <a class="nova-button secondary" href={apiKeyUrl}>
                    Create API key<span class="codicon codicon-link-external" aria-hidden="true"></span>
                </a>
            </div>
        </li>
        <li>
            <span class="step">2</span>
            <form onsubmit={submit}>
                <label for="apiKey">Paste the key</label>
                <input
                        id="apiKey"
                        class="nova-input"
                        type="password"
                        bind:value={apiKey}
                        placeholder="sk_live_…"
                        autocomplete="off"
                        spellcheck="false"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? 'apiKeyError' : undefined}
                        disabled={busy}
                />
                {#if error}
                    <p id="apiKeyError" class="error" role="alert">
                        <span class="codicon codicon-error" aria-hidden="true"></span>{error}
                    </p>
                {/if}
                <button class="nova-button" type="submit" disabled={busy || !apiKey.trim()}>
                    {#if busy}
                        <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>Connecting…
                    {:else}
                        Connect
                    {/if}
                </button>
            </form>
        </li>
    </ol>

    <a class="docs" href={docsUrl}>
        <span class="codicon codicon-book" aria-hidden="true"></span>Nova AI documentation
    </a>
</section>

<style lang="scss">
  .connect {
    display: grid;
    gap: 16px;
    padding: 12px 20px 20px;
  }

  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: -6px;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-muted);
    font: inherit;
    cursor: pointer;

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-hover-fg);
    }
  }

  header {
    display: grid;
    gap: 6px;
  }

  h1 {
    margin: 0;
    font-size: 1.2em;
    font-weight: 600;
  }

  header p {
    color: var(--nova-muted);
  }

  code {
    font-family: var(--nova-mono);
    font-size: 0.95em;
  }

  .steps {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 20px 1fr;
      gap: 10px;
    }

    li > div,
    form {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
  }

  .step {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 0.85em;
    font-weight: 600;
  }

  label {
    color: var(--nova-fg);
  }

  .error {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--nova-error-border);
    border-radius: 2px;
    background: var(--nova-error-bg);
    color: var(--nova-fg);
    overflow-wrap: anywhere;

    .codicon {
      color: var(--nova-error);
    }
  }

  .docs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-self: start;
  }
</style>
