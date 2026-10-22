<script lang="ts">
  import type { ChatState } from "../../../src/panel/protocol";
  import {
    PERMISSION_OPTIONS,
    permissionOption,
  } from "../../../src/panel/agentModes";

  let {
    chat,
    post,
  }: { chat: ChatState; post: (message: Record<string, unknown>) => void } =
    $props();

  /** Which dropdown is open: the agent one or the permissions one. */
  let open = $state<"agent" | "permission" | undefined>();
  let wrap: HTMLElement | undefined = $state();

  const agent = $derived(
    chat.agents.find((candidate) => candidate.id === chat.agent) ??
      chat.agents[0],
  );
  const permission = $derived(permissionOption(chat.approvalMode));
  const builtIn = $derived(
    chat.agents.filter((candidate) => candidate.source === "builtin"),
  );
  const custom = $derived(
    chat.agents.filter((candidate) => candidate.source !== "builtin"),
  );

  /**
   * A webview cannot draw outside its panel, so keep the menu inside it: as wide as the
   * panel allows (up to 320px) and shifted left when it would run past the right edge.
   */
  function fit(node: HTMLElement) {
    const margin = 8;
    const anchor = node.parentElement!.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - margin * 2);
    const left = Math.max(
      margin - anchor.left,
      Math.min(0, window.innerWidth - margin - width - anchor.left),
    );
    node.style.width = `${width}px`;
    node.style.left = `${left}px`;
  }

  function pickAgent(id: string) {
    post({ command: "chat/setAgent", id });
    open = undefined;
  }

  function pickPermission(mode: string) {
    post({ command: "chat/setApprovalMode", mode });
    open = undefined;
  }

  function onMenuKey(event: KeyboardEvent) {
    const move =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!move || !wrap) {
      return;
    }
    event.preventDefault();
    const items = [
      ...wrap.querySelectorAll<HTMLElement>("[data-menu-item]"),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + move + items.length) % items.length]?.focus();
  }

  // Close on outside click or Escape, like the context popover.
  $effect(() => {
    if (!open) {
      return;
    }
    function onDown(event: Event) {
      if (wrap && !wrap.contains(event.target as Node)) {
        open = undefined;
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        open = undefined;
      }
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  });
</script>

{#snippet agentRow(option: ChatState["agents"][number])}
  <button
    class="row"
    class:current={option.id === chat.agent}
    type="button"
    role="menuitemradio"
    aria-checked={option.id === chat.agent}
    data-menu-item
    onclick={() => pickAgent(option.id)}
  >
    <span class={`codicon codicon-${option.icon} lead`} aria-hidden="true"
    ></span>
    <span class="text">
      <span class="name">
        {option.name}
        {#if option.source !== "builtin"}<span class="pill">{option.source}</span
          >{/if}
      </span>
      <span class="desc">{option.description}</span>
    </span>
    {#if option.id === chat.agent}
      <span class="codicon codicon-check tick" aria-hidden="true"></span>
    {/if}
  </button>
{/snippet}

<div class="status" bind:this={wrap}>
  <div class="drop">
    <button
      class="chip"
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === "agent"}
      title="Agent mode (Shift+Tab to switch)"
      onclick={() => (open = open === "agent" ? undefined : "agent")}
    >
      <span class={`codicon codicon-${agent?.icon ?? "comment"}`} aria-hidden="true"
      ></span>
      <span class="label">{agent?.name ?? "Interactive"}</span>
      <span class="codicon codicon-chevron-up caret" aria-hidden="true"></span>
    </button>
    {#if open === "agent"}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="pop" role="menu" aria-label="Agent mode" onkeydown={onMenuKey} use:fit>
        {#each builtIn as option (option.id)}
          {@render agentRow(option)}
        {/each}
        {#if custom.length}
          <div class="rule"></div>
          {#each custom as option (option.id)}
            {@render agentRow(option)}
          {/each}
        {/if}
        <div class="rule"></div>
        <button
          class="row manage"
          type="button"
          role="menuitem"
          data-menu-item
          onclick={() => {
            post({ command: "chat/manageAgents" });
            open = undefined;
          }}
        >
          <span class="codicon codicon-settings-gear lead" aria-hidden="true"></span>
          <span class="text"><span class="name">Manage agents…</span></span>
        </button>
      </div>
    {/if}
  </div>

  <div class="drop">
    <button
      class="chip"
      class:warn={chat.approvalMode === "autoAll"}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === "permission"}
      title="When to ask before running tools"
      onclick={() => (open = open === "permission" ? undefined : "permission")}
    >
      <span class={`codicon codicon-${permission.icon}`} aria-hidden="true"
      ></span>
      <span class="label">{permission.label}</span>
      <span class="codicon codicon-chevron-up caret" aria-hidden="true"></span>
    </button>
    {#if open === "permission"}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="pop" role="menu" aria-label="Permissions" onkeydown={onMenuKey} use:fit>
        {#each PERMISSION_OPTIONS as option (option.mode)}
          <button
            class="row"
            class:current={option.mode === chat.approvalMode}
            class:danger={option.mode === "autoAll"}
            type="button"
            role="menuitemradio"
            aria-checked={option.mode === chat.approvalMode}
            data-menu-item
            onclick={() => pickPermission(option.mode)}
          >
            <span class={`codicon codicon-${option.icon} lead`} aria-hidden="true"
            ></span>
            <span class="text">
              <span class="name">
                {option.label}
                {#if option.experimental}<span class="pill outline"
                    >Experimental</span
                  >{/if}
              </span>
              <span class="desc">{option.description}</span>
            </span>
            {#if option.mode === chat.approvalMode}
              <span class="codicon codicon-check tick" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .status {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    padding: 2px 4px 0;
    /* Lets the chips drop their text when the panel is narrow (container query below). */
    container-type: inline-size;
  }

  @container (max-width: 300px) {
    .label {
      display: none;
    }
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;

    &:hover,
    &[aria-expanded="true"] {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--nova-fg);
    }

    &.warn {
      color: var(--nova-warning);
    }
  }

  .drop {
    position: relative;
    min-width: 0;
  }

  .caret {
    font-size: 0.8em;
    opacity: 0.7;
  }

  .pop {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 40;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--nova-border);
    border-radius: var(--nova-radius-large, 8px);
    background: var(--nova-surface);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
  }

  .rule {
    height: 1px;
    margin: 6px 4px;
    background: var(--nova-subtle-border, var(--nova-border));
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--nova-hover);
      outline: none;
    }

    &.current {
      background: var(--nova-hover);
    }

    &.danger .lead {
      color: var(--nova-warning);
    }
  }

  .lead {
    margin-top: 2px;
    color: var(--nova-muted);
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }

  .desc {
    color: var(--nova-muted);
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }

  .tick {
    margin-top: 2px;
    color: var(--nova-focus);
  }

  .pill {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--nova-hover);
    color: var(--nova-muted);
    font-size: 0.8em;
    font-weight: 400;

    &.outline {
      border: 1px solid var(--nova-border);
      background: transparent;
    }
  }

  .manage {
    color: var(--nova-link);

    .lead {
      color: inherit;
    }
  }
</style>
