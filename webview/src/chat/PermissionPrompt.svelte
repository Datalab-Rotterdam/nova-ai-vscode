<script lang="ts">
  import type {
    ApprovalDecision,
    ChatState,
    ToolItem,
  } from "../../../src/panel/protocol";

  let {
    chat,
    post,
  }: { chat: ChatState; post: (message: Record<string, unknown>) => void } =
    $props();

  const pending = $derived(
    chat.items.filter(
      (item): item is ToolItem =>
        item.kind === "tool" && item.status === "awaiting-approval",
    ),
  );
  const current = $derived(pending[0]);
  const agent = $derived(chat.subagents?.find((candidate) => candidate.id === current?.agentId));
  const preview = $derived(current?.detail ?? current?.input ?? "");

  function decide(decision: ApprovalDecision) {
    if (current) {
      post({ command: "chat/approval", itemId: current.id, decision });
    }
  }

  /** Enter and Escape answer the prompt, unless the user is typing something. */
  $effect(() => {
    if (!current) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
          ? target.value.trim() !== ""
          : false;
      const onButton = target instanceof HTMLButtonElement || target instanceof HTMLSelectElement;
      if (typing || (onButton && event.key === "Enter")) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        decide("approve");
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        decide("reject");
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

{#if current}
  <div class="prompt" role="alertdialog" aria-label="Permission request">
    <div class="head">
      <span class="codicon codicon-shield" aria-hidden="true"></span>
      <span class="title">{current.title}</span>
      {#if pending.length > 1}
        <span class="count">1 of {pending.length}</span>
      {/if}
    </div>
    <div class="ask">{agent ? `Agent "${agent.name}" wants to do this. Allow it?` : "Nova wants to do this. Allow it?"}</div>
    {#if preview}
      <code class="preview">{preview}</code>
    {/if}
    {#if current.allowRule}
      <div class="rule">
        Always allow adds <code>{current.allowRule}</code>
      </div>
    {/if}
    <div class="buttons">
      <button class="nova-button" type="button" onclick={() => decide("approve")}>
        Allow <kbd>⏎</kbd>
      </button>
      <button
        class="nova-button secondary"
        type="button"
        title="Allow every tool call in this chat"
        onclick={() => decide("approveSession")}
      >
        Allow in this chat
      </button>
      {#if current.allowRule}
        <button
          class="nova-button secondary"
          type="button"
          title="Saved to .nova-ai/settings.local.json"
          onclick={() => decide("approveAlways")}
        >
          Always allow
        </button>
      {/if}
      <button class="nova-button secondary" type="button" onclick={() => decide("reject")}>
        Reject <kbd>Esc</kbd>
      </button>
    </div>
    {#if current.editPath}
      <button
        class="link"
        type="button"
        onclick={() => post({ command: "chat/openDiff", itemId: current.id })}
      >
        <span class="codicon codicon-diff" aria-hidden="true"></span>Review changes
      </button>
    {/if}
  </div>
{/if}

<style lang="scss">
  .prompt {
    display: grid;
    gap: 6px;
    margin-top: 6px;
    padding: 8px 10px;
    border: 1px solid var(--nova-focus);
    border-radius: var(--nova-radius-large, 8px);
    background: var(--nova-surface);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;

    .codicon {
      color: var(--nova-focus);
    }
  }

  .count {
    margin-left: auto;
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 400;
  }

  .ask {
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .preview {
    display: block;
    max-height: 160px;
    overflow: auto;
    padding: 4px 6px;
    border-radius: var(--nova-radius);
    background: var(--nova-input-bg);
    font-family: var(--nova-mono);
    font-size: 0.92em;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .rule {
    color: var(--nova-muted);
    font-size: 0.85em;

    code {
      font-family: var(--nova-mono);
    }
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    .nova-button {
      width: auto;
      flex: 1 1 auto;
      padding: 2px 8px;
    }
  }

  kbd {
    margin-left: 4px;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    font: inherit;
    font-size: 0.8em;
    opacity: 0.7;
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
</style>
