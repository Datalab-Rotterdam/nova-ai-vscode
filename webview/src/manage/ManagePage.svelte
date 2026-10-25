<script lang="ts">
    import {onMount, type Snippet} from 'svelte';

    /** Shared frame of the Tools, Skills and Agents pages: title, description, search and a scrolling list of sections. */
    let {title, description, noun, query = $bindable(''), found, tabs, scope, onScope, summary, children}: {
        title: string;
        description: string;
        /** Plural, for the search box: "skills". */
        noun: string;
        query?: string;
        /** Matches while a search is typed. */
        found: number;
        /** Optional switch under the search box (the Tools page: User or Project). */
        tabs?: Array<{id: string; label: string; disabled?: boolean; title?: string}>;
        scope?: string;
        onScope?: (id: string) => void;
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
    <main>
        <div class="column">
            <header>
                <h1>{title}</h1>
                <p class="description">{description}</p>
                <div class="search">
                    <span class="codicon codicon-search" aria-hidden="true"></span>
                    <input bind:this={search} bind:value={query} type="text" placeholder={`Search ${noun}`} aria-label={`Search ${noun}`}/>
                    {#if query}
                        <span class="count">{found} found</span>
                        <button class="clear codicon codicon-close" title="Clear search" aria-label="Clear search" onclick={() => { query = ''; search?.focus(); }}></button>
                    {/if}
                </div>
                {#if tabs}
                    <div class="tabs" role="tablist" aria-label="Scope">
                        {#each tabs as tab (tab.id)}
                            <button role="tab" class:active={scope === tab.id} aria-selected={scope === tab.id} disabled={tab.disabled} title={tab.title} onclick={() => onScope?.(tab.id)}>{tab.label}</button>
                        {/each}
                    </div>
                {/if}
                {#if summary}<div class="summary">{@render summary()}</div>{/if}
            </header>
            {@render children()}
        </div>
    </main>
</div>

<style lang="scss">
  .page {
    height: 100vh;
    overflow: clip;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  main {
    height: 100%;
    overflow: hidden auto;
    padding: 24px 24px 48px;
  }

  .column {
    min-width: 0;
    max-width: 900px;
    margin: 0 auto;
  }

  header {
    margin-bottom: 16px;
  }

  h1 {
    margin: 0 0 4px;
    font-size: 1.6em;
    font-weight: 600;
  }

  .description {
    margin: 0 0 16px;
    color: var(--vscode-descriptionForeground, var(--nova-muted));
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
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

  .tabs {
    display: flex;
    gap: 4px;
    margin-top: 12px;
    border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));

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

  .summary {
    margin-top: 10px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }
</style>
