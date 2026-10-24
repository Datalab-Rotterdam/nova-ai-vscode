<script lang="ts" module>
    export interface MenuItem {
        label: string;
        /** A codicon name, without `codicon-`. */
        icon?: string;
        /** A key hint on the right, e.g. "F2". */
        hint?: string;
        /** Drawn in the error color, after a divider. */
        danger?: boolean;
        onSelect: () => void;
    }
</script>

<script lang="ts">
    import {tick} from 'svelte';

    /**
     * An icon button that opens a list of actions. The list is `position: fixed` next to the
     * button, so a scrolling list around it does not cut it off, and it flips above the button
     * when there is no room below. Arrow keys move, Enter picks, Escape closes.
     */
    let {items, icon = 'ellipsis', label}: {items: MenuItem[]; icon?: string; label: string} = $props();

    let open = $state(false);
    let trigger: HTMLButtonElement | undefined = $state();
    let menu: HTMLElement | undefined = $state();

    async function show() {
        open = true;
        await tick();
        if (!trigger || !menu) {
            return;
        }
        const margin = 4;
        const anchor = trigger.getBoundingClientRect();
        const box = menu.getBoundingClientRect();
        const below = anchor.bottom + margin + box.height <= window.innerHeight;
        menu.style.top = `${below ? anchor.bottom + margin : Math.max(margin, anchor.top - margin - box.height)}px`;
        menu.style.left = `${Math.max(margin, Math.min(anchor.right - box.width, window.innerWidth - margin - box.width))}px`;
        menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }

    function close(refocus = true) {
        open = false;
        if (refocus) {
            trigger?.focus();
        }
    }

    function pick(item: MenuItem) {
        close();
        item.onSelect();
    }

    function onKey(event: KeyboardEvent) {
        const entries = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        const focus = (next: number) => entries[(next + entries.length) % entries.length]?.focus();
        switch (event.key) {
            case 'ArrowDown': focus(index + 1); break;
            case 'ArrowUp': focus(index - 1); break;
            case 'Home': focus(0); break;
            case 'End': focus(-1); break;
            case 'Escape': close(); break;
            case 'Tab': close(false); return;
            default: return;
        }
        // Escape here must not also close the page around the menu.
        event.preventDefault();
        event.stopPropagation();
    }

    // Close on a click outside, or when anything scrolls (the menu would drift from its button).
    $effect(() => {
        if (!open) {
            return;
        }
        const onDown = (event: Event) => {
            if (!menu?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) {
                close(false);
            }
        };
        const onScroll = (event: Event) => {
            if (!menu?.contains(event.target as Node)) {
                close(false);
            }
        };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    });
</script>

<button
    bind:this={trigger}
    class="trigger codicon codicon-{icon}"
    class:open
    type="button"
    title={label}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : show())}
></button>
{#if open}
    <div class="menu" role="menu" aria-label={label} tabindex="-1" bind:this={menu} onkeydown={onKey}>
        {#each items as item, index (item.label)}
            {#if item.danger && index > 0}
                <div class="rule" role="separator"></div>
            {/if}
            <button class="item" class:danger={item.danger} type="button" role="menuitem" tabindex="-1" onclick={() => pick(item)}>
                <span class="codicon codicon-{item.icon ?? 'blank'}" aria-hidden="true"></span>
                <span class="text">{item.label}</span>
                {#if item.hint}<kbd>{item.hint}</kbd>{/if}
            </button>
        {/each}
    </div>
{/if}

<style lang="scss">
  .trigger {
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:hover,
    &.open {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--nova-fg);
    }
  }

  .menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    padding: 4px;
    border: 1px solid var(--nova-border);
    border-radius: var(--nova-radius-large, 8px);
    background: var(--vscode-menu-background, var(--vscode-dropdown-background, var(--vscode-editorWidget-background, var(--vscode-editor-background))));
    color: var(--vscode-menu-foreground, var(--nova-fg));
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
    outline: none;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--vscode-menu-selectionBackground, var(--nova-hover));
      color: var(--vscode-menu-selectionForeground, inherit);
      outline: none;
    }

    .codicon {
      color: var(--nova-muted);
    }

    &.danger,
    &.danger .codicon {
      color: var(--nova-error);
    }
  }

  .text {
    flex: 1;
  }

  kbd {
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.85em;
  }

  .rule {
    height: 1px;
    margin: 4px;
    background: var(--nova-subtle-border, var(--nova-border));
  }
</style>
