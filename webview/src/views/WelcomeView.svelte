<script lang="ts">
    import type {SidebarRenderState} from '../types';

    let {state, onGetStarted}: { state: SidebarRenderState; onGetStarted: () => void } = $props();

    const docsUrl = 'https://docs.datalabrotterdam.nl/services/nova-ai';
</script>

<section class="welcome">
    <div class="intro">
        {#if state.logoUri}
            <span class="nova-mark logo" style:--mark-url={`url("${state.logoUri}")`} aria-hidden="true"></span>
        {/if}
        <h1>Nova AI</h1>
        <p>Use Nova AI models in VS Code Chat, in agent mode and with <code>@nova</code>.</p>
    </div>

    <ul class="features">
        <li><span class="codicon codicon-comment-discussion" aria-hidden="true"></span>Chat with Nova models in the native chat view</li>
        <li><span class="codicon codicon-tools" aria-hidden="true"></span>Let agent mode edit files and run tools</li>
        <li><span class="codicon codicon-shield" aria-hidden="true"></span>Your key stays in VS Code's secret storage</li>
    </ul>

    <div class="actions">
        <button class="nova-button" onclick={onGetStarted}>Connect Nova AI</button>
        <a href={docsUrl}>Read the documentation</a>
    </div>

    {#if state.datalabLogoUri}
        <footer>
            <span class="nova-mark datalab" style:--mark-url={`url("${state.datalabLogoUri}")`} role="img" aria-label="DataLab Rotterdam"></span>
        </footer>
    {/if}
</section>

<style lang="scss">
  .welcome {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px 20px 16px;
  }

  .intro {
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
  }

  .logo {
    width: 40px;
    height: 40px;
    color: var(--nova-fg);
  }

  h1 {
    margin: 4px 0 0;
    font-size: 1.3em;
    font-weight: 600;
  }

  p {
    max-width: 30ch;
    color: var(--nova-muted);
  }

  code {
    font-family: var(--nova-mono);
    font-size: 0.95em;
  }

  .features {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 16px 1fr;
      gap: 8px;
      align-items: start;
      color: var(--nova-fg);
    }

    .codicon {
      margin-top: 1px;
      color: var(--nova-muted);
    }
  }

  .actions {
    display: grid;
    justify-items: center;
    gap: 10px;
  }

  footer {
    margin-top: auto;
    display: flex;
    justify-content: center;
    padding-top: 12px;
    color: var(--nova-muted);
    opacity: 0.7;
  }

  .datalab {
    width: 110px;
    height: 32px;
  }
</style>
