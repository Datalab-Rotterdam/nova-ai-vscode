<script lang="ts">
    import type {Snippet} from 'svelte';

    /** One tool, skill or agent: a card that folds open to its full text, notes and actions. */
    let {name, icon, description, location, note, dimmed = false, open: initiallyOpen = false, forceOpen = false, badges, control, extra, actions}: {
        name: string;
        /** Codicon name before the title. */
        icon?: string;
        description: string;
        location?: string;
        /** A warning that stays visible when the card is folded. */
        note?: string;
        dimmed?: boolean;
        /** Open at first; the reader can fold it. */
        open?: boolean;
        /** Stays open, for example while a search is typed. */
        forceOpen?: boolean;
        badges?: Snippet;
        /** A switch at the right of the header. */
        control?: Snippet;
        extra?: Snippet;
        actions?: Snippet;
    } = $props();

    let open = $state(false);
    $effect.pre(() => {
        open = initiallyOpen;
    });
    const expanded = $derived(open || forceOpen);
    const hasMore = $derived(Boolean(extra || actions || location));
</script>

<article class:dimmed class:expanded>
    <div class="row">
        <button class="head" aria-expanded={expanded} onclick={() => open = !expanded}>
            <span class="codicon codicon-chevron-{expanded ? 'down' : 'right'} chevron" aria-hidden="true"></span>
            {#if icon}<span class={`codicon codicon-${icon} icon`} aria-hidden="true"></span>{/if}
            <strong>{name}</strong>
            {#if badges}{@render badges()}{/if}
        </button>
        {#if control}<div class="control">{@render control()}</div>{/if}
    </div>
    <p class="description" class:clamped={!expanded}>{description}</p>
    {#if note}<p class="manage-note">{note}</p>{/if}
    {#if expanded && hasMore}
        {#if extra}{@render extra()}{/if}
        <div class="actions">
            {#if location}<span class="location" title={location}>{location}</span>{/if}
            {#if actions}{@render actions()}{/if}
        </div>
    {/if}
</article>

<style lang="scss">
  article {
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
    border-radius: 4px;

    &:hover,
    &:focus-within {
      background: var(--vscode-settings-rowHoverBackground, var(--nova-hover));
    }

    &.dimmed {
      opacity: 0.65;
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .head {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    strong {
      font-weight: 600;
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: 2px;
    }
  }

  .chevron {
    color: var(--nova-muted);
  }

  .control {
    display: flex;
    flex: none;
  }

  .icon {
    color: var(--nova-muted);
  }

  .description {
    margin: 4px 0 0 22px;
    color: var(--vscode-descriptionForeground);

    &.clamped {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    margin: 8px 0 0 22px;
    font-size: 0.9em;
  }

  .location {
    max-width: 100%;
    overflow: hidden;
    color: var(--nova-muted);
    font-family: var(--nova-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Used by the pages' own snippets (badges, extras, actions). */
  :global(.manage-badge) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 0.8em;
  }

  :global(.manage-link) {
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-link);
    font: inherit;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }

    &.danger {
      color: var(--nova-error);
    }
  }

  :global(.manage-note) {
    margin: 6px 0 0;
    color: var(--nova-warning);
    font-size: 0.9em;
  }

  :global(.manage-empty) {
    margin: 0;
    color: var(--nova-muted);
  }
</style>
