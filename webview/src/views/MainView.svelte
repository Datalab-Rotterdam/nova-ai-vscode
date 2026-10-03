<script lang="ts">
    import Avatar from '../chat/Avatar.svelte';
    import type {SidebarRenderState} from '../types';

    let {state, post, onBack}: {
        state: SidebarRenderState;
        post: (message: Record<string, unknown>) => void;
        onBack?: () => void;
    } = $props();

    const snapshot = $derived(state.snapshot);
    const models = $derived(state.models ?? []);
    const health = $derived(
        snapshot.connectionHealth === 'connected'
            ? {label: 'Connected', icon: 'pass-filled', tone: 'ok'}
            : snapshot.connectionHealth === 'degraded'
                ? {label: 'Connection problem', icon: 'warning', tone: 'warn'}
                : {label: 'Signed out', icon: 'circle-slash', tone: 'muted'}
    );
    const host = $derived(hostOf(snapshot.accountSummary?.baseUrl));
    const validatedAt = $derived(
        snapshot.accountSummary?.validatedAt ? new Date(snapshot.accountSummary.validatedAt).toLocaleString() : undefined
    );

    const memoryLinks = [
        {icon: 'book', title: 'Project memory', detail: 'Private notes Nova keeps about this workspace', command: 'nova.openProjectMemory'},
        {icon: 'account', title: 'Global memory', detail: 'Your preferences, for all projects', command: 'nova.openGlobalMemory'},
        {icon: 'folder-opened', title: 'Nova folder', detail: 'Chats and scratch files in ~/.nova-ai', command: 'nova.revealHome'}
    ];

    function hostOf(url?: string): string | undefined {
        try {
            return url ? new URL(url).host : undefined;
        } catch {
            return url;
        }
    }

    function formatTokens(value: number): string {
        return value >= 1_000_000 ? `${Math.round(value / 100_000) / 10}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value);
    }

    const actions = $derived([
        ...(onBack ? [{
            icon: 'comment-discussion',
            title: 'Nova chat',
            detail: 'Back to the chat in this panel',
            run: () => onBack?.()
        }] : []),
        {
            icon: 'mention',
            title: 'Ask @nova',
            detail: 'Chat with Nova and let it use VS Code tools',
            run: () => post({command: 'nova.openChat', query: '@nova ', mode: 'ask'})
        },
        {
            icon: 'robot',
            title: 'Agent mode',
            detail: 'Pick a Nova model in the chat model picker',
            run: () => post({command: 'nova.openChat', mode: 'agent'})
        },
        {
            icon: 'list-selection',
            title: 'Manage models',
            detail: 'Show or hide Nova models in the picker',
            run: () => post({command: 'nova.manageModels'})
        }
    ]);
</script>

<section class="main">
    {#if onBack}
        <button class="back" onclick={onBack}>
            <span class="codicon codicon-arrow-left" aria-hidden="true"></span>Chat
        </button>
    {/if}
    <div class={`status ${health.tone}`} role="status">
        {#if state.profile}
            <Avatar profile={state.profile} size={28}/>
        {:else}
            <span class={`codicon codicon-${health.icon}`} aria-hidden="true"></span>
        {/if}
        <div class="status-copy">
            <strong>{state.profile?.name ?? health.label}</strong>
            {#if state.profile?.name}<span class={`health ${health.tone}`}><span class={`codicon codicon-${health.icon}`} aria-hidden="true"></span>{health.label}</span>{/if}
            {#if host}<span title={validatedAt ? `Validated ${validatedAt}` : undefined}>{host}</span>{/if}
        </div>
        {#if snapshot.connectionHealth === 'degraded'}
            <button class="link-button" onclick={() => post({command: 'nova.refreshModels'})}>Retry</button>
        {/if}
    </div>
    {#if snapshot.connectionHealth === 'degraded' && snapshot.lastError}
        <p class="status-error">{snapshot.lastError}</p>
    {/if}

    <h2>Start</h2>
    <ul class="list">
        {#each actions as action (action.title)}
            <li>
                <button class="row" onclick={action.run}>
                    <span class={`codicon codicon-${action.icon}`} aria-hidden="true"></span>
                    <span class="row-copy">
                        <span class="row-title">{action.title}</span>
                        <span class="row-detail">{action.detail}</span>
                    </span>
                    <span class="codicon codicon-chevron-right chevron" aria-hidden="true"></span>
                </button>
            </li>
        {/each}
    </ul>

    <h2>
        Models
        {#if models.length}<span class="count">{models.length}</span>{/if}
    </h2>
    {#if models.length}
        <ul class="list models">
            {#each models as model (model.id)}
                <li class="model" title={[model.detail, model.pricing].filter(Boolean).join('\n') || undefined}>
                    <span class="codicon codicon-sparkle" aria-hidden="true"></span>
                    <span class="row-copy">
                        <span class="row-title">{model.name}</span>
                        <span class="row-detail">{formatTokens(model.contextWindow)} context{model.pricing ? ` · ${model.pricing}` : ''}</span>
                    </span>
                    <span class="badges">
                        {#if model.toolCalling}
                            <span class="codicon codicon-tools" title="Tool calling (agent mode)" aria-label="Tool calling"></span>
                        {/if}
                        {#if model.imageInput}
                            <span class="codicon codicon-eye" title="Image input" aria-label="Image input"></span>
                        {/if}
                    </span>
                </li>
            {/each}
        </ul>
    {:else}
        <p class="empty">
            No models loaded yet.
            <button class="link-button" onclick={() => post({command: 'nova.refreshModels'})}>Refresh</button>
        </p>
    {/if}

    <h2>Memory</h2>
    <ul class="list">
        {#each memoryLinks as link (link.title)}
            <li>
                <button class="row" onclick={() => post({command: link.command})}>
                    <span class={`codicon codicon-${link.icon}`} aria-hidden="true"></span>
                    <span class="row-copy">
                        <span class="row-title">{link.title}</span>
                        <span class="row-detail">{link.detail}</span>
                    </span>
                    <span class="codicon codicon-chevron-right chevron" aria-hidden="true"></span>
                </button>
            </li>
        {/each}
    </ul>

    <p class="disclaimer">AI can make mistakes. Review important output.</p>
</section>

<style lang="scss">
  .main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 8px 0 12px;
  }

  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 6px 4px;
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

  .health {
    display: inline-flex;
    align-items: center;
    gap: 4px;

    &.ok .codicon {
      color: var(--nova-success);
    }

    &.warn .codicon {
      color: var(--nova-warning);
    }
  }

  .status {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    margin: 4px 12px 8px;
    padding: 8px 10px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);

    &.ok > .codicon {
      color: var(--nova-success);
    }

    &.warn > .codicon {
      color: var(--nova-warning);
    }

    &.muted > .codicon {
      color: var(--nova-muted);
    }
  }

  .status-copy {
    display: grid;
    min-width: 0;

    strong {
      font-weight: 600;
    }

    span {
      overflow: hidden;
      color: var(--nova-muted);
      font-size: 0.9em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .status-error {
    margin: -2px 12px 8px;
    color: var(--nova-error);
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 0 4px;
    padding: 0 20px;
    color: var(--nova-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 10px;
    line-height: 16px;
    text-align: center;
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row,
  .model {
    width: 100%;
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 20px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;

    > .codicon:first-child {
      color: var(--nova-muted);
    }
  }

  .row {
    cursor: pointer;

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-hover-fg);

      .chevron {
        visibility: visible;
      }
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: -1px;
    }
  }

  :global(body.vscode-high-contrast) .row:hover,
  :global(body.vscode-high-contrast-light) .row:hover {
    border-color: var(--vscode-contrastActiveBorder);
    border-style: dashed;
  }

  .chevron {
    visibility: hidden;
    color: var(--nova-muted);
  }

  .row-copy {
    display: grid;
    min-width: 0;
  }

  .row-title,
  .row-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-detail {
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .badges {
    display: flex;
    gap: 4px;
    color: var(--nova-muted);
  }

  .empty {
    padding: 4px 20px;
    color: var(--nova-muted);
  }

  .link-button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-link);
    font: inherit;
    cursor: pointer;

    &:hover {
      color: var(--nova-link-active);
      text-decoration: underline;
    }
  }

  .disclaimer {
    margin-top: auto;
    padding: 16px 20px 0;
    color: var(--nova-muted);
    font-size: 0.85em;
    text-align: center;
  }
</style>
