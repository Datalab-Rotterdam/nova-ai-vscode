<script lang="ts">
    import {onMount, type Snippet} from 'svelte';
    import type {CustomizeSection} from '../../../src/views/sections';

    /** One entry of the left nav; `body` renders the section. */
    let {sections, initial, vscode, post}: {
        sections: Array<{id: CustomizeSection; label: string; icon: string; count?: number; body: Snippet}>;
        initial: CustomizeSection;
        vscode: {getState?: () => unknown; setState?: (state: unknown) => void} | undefined;
        post: (message: Record<string, unknown>) => void;
    } = $props();

    const saved = (vscode?.getState?.() as {section?: CustomizeSection} | undefined)?.section;
    let current = $state<CustomizeSection>(saved && sections.some((section) => section.id === saved) ? saved : initial);
    const body = $derived(sections.find((section) => section.id === current)?.body);

    /** Switches to a section, for a page that links to another. */
    export function show(id: CustomizeSection) {
        current = id;
        vscode?.setState?.({...(vscode.getState?.() as object | undefined), section: id});
    }

    onMount(() => {
        const onMessage = (event: MessageEvent<{type?: string; section?: CustomizeSection}>) => {
            if (event.data?.type === 'customize/section' && event.data.section) {
                show(event.data.section);
            }
        };
        window.addEventListener('message', onMessage);
        post({command: 'customize/ready'});
        return () => window.removeEventListener('message', onMessage);
    });
</script>

<div class="shell">
    <nav aria-label="Customizations">
        <h1>Nova</h1>
        {#each sections as section (section.id)}
            <button class:active={current === section.id} aria-current={current === section.id ? 'page' : undefined} onclick={() => show(section.id)}>
                <span class="codicon codicon-{section.icon}" aria-hidden="true"></span>
                <span class="label">{section.label}</span>
                {#if section.count !== undefined}<span class="count">{section.count}</span>{/if}
            </button>
        {/each}
    </nav>
    <div class="body">
        {#if body}{@render body()}{/if}
    </div>
</div>

<style lang="scss">
  .shell {
    display: flex;
    height: 100vh;
    overflow: clip;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  nav {
    flex: none;
    width: 220px;
    padding: 12px 8px;
    overflow-y: auto;
    border-right: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));

    h1 {
      margin: 4px 8px 12px;
      font-size: 1.1em;
      font-weight: 600;
    }

    button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--vscode-foreground);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover {
        background: var(--vscode-list-hoverBackground);
      }

      &.active {
        background: var(--vscode-list-inactiveSelectionBackground);
        color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground));
      }

      &:focus-visible {
        outline: 1px solid var(--nova-focus);
        outline-offset: -1px;
      }
    }

    .label {
      flex: 1;
    }

    .count {
      padding: 0 6px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 0.85em;
    }
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 640px) {
    nav {
      width: 48px;

      h1, .label, .count {
        display: none;
      }
    }
  }
</style>
