<script lang="ts">
    import type {Snippet} from 'svelte';

    /** A collapsible group of cards, with its own actions (such as "New Skill") on the right of the header. */
    let {title, hint, count, open: initiallyOpen = true, forceOpen = false, actions, children}: {
        title: string;
        hint?: string;
        count?: number;
        /** Open at first; the reader can fold it. */
        open?: boolean;
        /** Stays open, for example while a search is typed. */
        forceOpen?: boolean;
        actions?: Snippet;
        children: Snippet;
    } = $props();

    let open = $state(true);
    $effect.pre(() => {
        open = initiallyOpen;
    });
    const expanded = $derived(open || forceOpen);
</script>

<section>
    <div class="head">
        <button class="toggle" aria-expanded={expanded} onclick={() => open = !expanded}>
            <span class="codicon codicon-chevron-{expanded ? 'down' : 'right'}" aria-hidden="true"></span>
            <h2>{title}</h2>
            {#if count !== undefined}<span class="count">{count}</span>{/if}
        </button>
        {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
    {#if expanded}
        {#if hint}<p class="hint">{hint}</p>{/if}
        <div class="items">
            {@render children()}
        </div>
    {/if}
</section>

<style lang="scss">
  section {
    min-width: 0;
    margin-bottom: 12px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
  }

  .toggle {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 4px;
    border: 0;
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
    }
  }

  h2 {
    margin: 0;
    font-size: 1.05em;
    font-weight: 600;
  }

  .count {
    padding: 0 7px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 0.8em;
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
  }

  .hint {
    margin: 8px 4px 0;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .items {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    margin-top: 10px;
  }

  /* Buttons in a section header, used by the pages' action snippets. */
  :global(.manage-button) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid var(--nova-button-border);
    border-radius: 2px;
    background: var(--nova-secondary-bg);
    color: var(--nova-secondary-fg);
    font: inherit;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--nova-secondary-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  :global(.manage-icon-button) {
    padding: 4px;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--vscode-foreground);
    }
  }
</style>
