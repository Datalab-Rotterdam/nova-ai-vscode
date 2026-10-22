<script lang="ts">
    import type {ToolItem} from '../../../src/panel/protocol';
    import DiffView from './DiffView.svelte';

    let {item, post}: { item: ToolItem; post: (message: Record<string, unknown>) => void } = $props();

    let expanded = $state(false);

    const icon = $derived({
        'awaiting-approval': 'shield',
        running: 'loading codicon-modifier-spin',
        done: 'check',
        error: 'error',
        rejected: 'circle-slash'
    }[item.status]);

</script>

<div class={`tool ${item.status}`}>
    <button class="summary" onclick={() => expanded = !expanded} aria-expanded={expanded}>
        <span class={`codicon codicon-${icon} status-icon`} aria-hidden="true"></span>
        <span class="title">{item.title}</span>
        {#if item.detail && item.status !== 'awaiting-approval'}
            <span class="detail">{item.detail}</span>
        {/if}
        <span class={`codicon codicon-chevron-${expanded ? 'up' : 'down'} chevron`} aria-hidden="true"></span>
    </button>

    {#if item.status === 'awaiting-approval'}
        <div class="waiting">Waiting for your answer under the message box.</div>
    {:else if item.editPath && item.status === 'done'}
        {#if item.diff?.lines.length}
            <div class="inline-diff">
                <DiffView lines={item.diff.lines} truncated={item.diff.truncated} onOpen={() => post({command: 'chat/openDiff', itemId: item.id})}/>
            </div>
        {/if}
        <div class="links">
            <button class="link" onclick={() => post({command: 'chat/openDiff', itemId: item.id})}>
                <span class="codicon codicon-diff" aria-hidden="true"></span>Diff
            </button>
            <button class="link" onclick={() => post({command: 'chat/openFile', path: item.editPath})}>
                <span class="codicon codicon-go-to-file" aria-hidden="true"></span>Open
            </button>
        </div>
    {/if}

    {#if expanded}
        <div class="body">
            <div class="label">Input</div>
            <pre>{item.input}</pre>
            {#if item.output}
                <div class="label">Output</div>
                <pre>{item.output}</pre>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
  .tool {
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);

    &.awaiting-approval {
      border-color: var(--nova-focus);
    }
  }

  .summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover .chevron {
      visibility: visible;
    }
  }

  .status-icon,
  .chevron {
    flex: none;
  }

  .title,
  .detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    flex: 0 1 auto;
  }

  .detail {
    flex: 0 1000 auto;
  }

  /* Always at the right edge, with or without a detail. */
  .chevron {
    margin-left: auto;
  }

  .detail {
    color: var(--nova-muted);
    font-family: var(--nova-mono);
    font-size: 0.9em;
  }

  .chevron {
    visibility: hidden;
    color: var(--nova-muted);
  }

  .status-icon {
    color: var(--nova-muted);
  }

  .done .status-icon {
    color: var(--nova-success);
  }

  .error .status-icon {
    color: var(--nova-error);
  }

  .awaiting-approval .status-icon {
    color: var(--nova-focus);
  }

  .waiting {
    padding: 0 8px 8px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .links {
    display: flex;
    gap: 12px;
    padding: 4px 8px 6px;
  }

  .inline-diff {
    padding: 0 8px;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-link);
    font: inherit;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  .body {
    display: grid;
    gap: 4px;
    padding: 0 8px 8px;
  }

  .label {
    color: var(--nova-muted);
    font-size: 0.85em;
    text-transform: uppercase;
  }

  pre {
    max-height: 240px;
    margin: 0;
    overflow: auto;
    padding: 6px;
    border-radius: var(--nova-radius);
    background: var(--nova-input-bg);
    font-family: var(--nova-mono);
    font-size: 0.9em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
