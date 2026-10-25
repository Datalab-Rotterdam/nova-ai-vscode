<script lang="ts">
    import {onMount, type Snippet} from 'svelte';

    /** Shared frame of the Skills and Agents pages: search, scope tabs, actions and a scrolling list. */
    let {noun, query = $bindable(''), found, tabs, scope, onScope, onCreate, createLabel, canCreate = true, onOpenFolder, summary, children}: {
        /** Plural, for the search box: "skills". */
        noun: string;
        query?: string;
        /** Matches while a search is typed. */
        found: number;
        tabs: Array<{id: string; label: string; disabled?: boolean; title?: string}>;
        scope: string;
        onScope: (id: string) => void;
        onCreate: () => void;
        createLabel: string;
        canCreate?: boolean;
        /** Without it the folder button is hidden (nothing to open for built-in items). */
        onOpenFolder?: () => void;
        summary?: Snippet;
        children: Snippet;
    } = $props();

    let search: HTMLInputElement | undefined = $state();

    onMount(() => search?.focus());

    function onKey(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            search?.focus();
            search?.select();
        } else if (event.key === 'Escape' && document.activeElement === search && query) {
            query = '';
        }
    }
</script>

<svelte:window onkeydown={onKey}/>

<div class="page">
    <header>
        <div class="search">
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input bind:this={search} bind:value={query} type="text" placeholder={`Search ${noun}`} aria-label={`Search ${noun}`}/>
            {#if query}
                <span class="count">{found} found</span>
                <button class="clear codicon codicon-close" title="Clear search" aria-label="Clear search" onclick={() => { query = ''; search?.focus(); }}></button>
            {/if}
        </div>
        <div class="bar">
            <div class="tabs" role="tablist" aria-label="Scope">
                {#each tabs as tab (tab.id)}
                    <button role="tab" class:active={scope === tab.id} aria-selected={scope === tab.id} disabled={tab.disabled} title={tab.title} onclick={() => onScope(tab.id)}>{tab.label}</button>
                {/each}
            </div>
            <span class="spacer"></span>
            {#if onOpenFolder}
                <button class="button secondary" onclick={onOpenFolder} disabled={!canCreate}>
                    <span class="codicon codicon-folder-opened" aria-hidden="true"></span> Open Folder
                </button>
            {/if}
            {#if canCreate || !onOpenFolder}
                <button class="button primary" onclick={onCreate} disabled={!canCreate}>
                    <span class="codicon codicon-add" aria-hidden="true"></span> {createLabel}
                </button>
            {/if}
        </div>
        {#if summary}<div class="summary">{@render summary()}</div>{/if}
    </header>

    <main>
        <div class="column">
            {@render children()}
        </div>
    </main>
</div>

<style lang="scss">
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: clip;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  header {
    flex: none;
    padding: 16px 24px 0;
    border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 900px;
    padding: 0 8px;
    border: 1px solid var(--vscode-settings-textInputBorder, var(--nova-input-border));
    border-radius: 2px;
    background: var(--vscode-settings-textInputBackground, var(--nova-input-bg));
    color: var(--vscode-settings-textInputForeground, var(--nova-input-fg));

    &:focus-within {
      border-color: var(--nova-focus);
    }

    input {
      flex: 1;
      min-width: 0;
      padding: 7px 0;
      border: 0;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;

      &::placeholder {
        color: var(--nova-input-placeholder);
      }
    }

    .count {
      color: var(--nova-muted);
      font-size: 0.9em;
      white-space: nowrap;
    }

    .clear {
      padding: 2px;
      border: 0;
      background: none;
      color: var(--nova-muted);
      cursor: pointer;

      &:hover {
        color: var(--vscode-foreground);
      }
    }
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    max-width: 900px;
    margin-top: 12px;
  }

  .tabs {
    display: flex;
    gap: 4px;

    button {
      padding: 4px 10px 8px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--vscode-panelTitle-inactiveForeground, var(--nova-muted));
      font: inherit;
      font-weight: 600;
      cursor: pointer;

      &.active {
        border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--nova-focus));
        color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  .spacer {
    flex: 1;
  }

  .button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    padding: 4px 10px;
    border: 1px solid var(--nova-button-border);
    border-radius: 2px;
    font: inherit;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &.primary {
      background: var(--nova-button-bg);
      color: var(--nova-button-fg);

      &:hover:not(:disabled) {
        background: var(--nova-button-hover);
      }
    }

    &.secondary {
      background: var(--nova-secondary-bg);
      color: var(--nova-secondary-fg);

      &:hover:not(:disabled) {
        background: var(--nova-secondary-hover);
      }
    }
  }

  .summary {
    max-width: 900px;
    padding-bottom: 8px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  main {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 24px 40px;
  }

  .column {
    max-width: 900px;
  }
</style>
