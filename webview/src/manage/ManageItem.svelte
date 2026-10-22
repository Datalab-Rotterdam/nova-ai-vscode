<script lang="ts">
    import type {Snippet} from 'svelte';

    /** One skill or agent: a card with a title row, description, optional extras and actions. */
    let {name, icon, description, location, dimmed = false, badges, extra, actions}: {
        name: string;
        /** Codicon name before the title. */
        icon?: string;
        description: string;
        location?: string;
        dimmed?: boolean;
        badges?: Snippet;
        extra?: Snippet;
        actions?: Snippet;
    } = $props();
</script>

<article class:dimmed>
    <div class="title">
        {#if icon}<span class={`codicon codicon-${icon} icon`} aria-hidden="true"></span>{/if}
        <strong>{name}</strong>
        {#if badges}{@render badges()}{/if}
    </div>
    <p class="description">{description}</p>
    {#if extra}{@render extra()}{/if}
    {#if location || actions}
        <div class="actions">
            {#if location}<span class="location" title={location}>{location}</span>{/if}
            {#if actions}{@render actions()}{/if}
        </div>
    {/if}
</article>

<style lang="scss">
  article {
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

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;

    strong {
      font-weight: 600;
    }
  }

  .icon {
    color: var(--nova-muted);
  }

  .description {
    margin: 4px 0 0;
    color: var(--vscode-descriptionForeground);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    margin-top: 8px;
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
