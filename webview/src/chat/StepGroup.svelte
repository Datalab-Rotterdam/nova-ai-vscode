<script lang="ts">
  import type { ConversationItem } from "../../../src/panel/steps";
  import { stepsLine, thoughtFor } from "../../../src/panel/steps";
  import ToolCard from "./ToolCard.svelte";

  /**
   * Consecutive steps (thinking, tool calls) of an answer in a row, folded into one line
   * that says what Nova is doing, or did; it opens to the separate steps. Ported from the
   * Nova AI desktop app. A group with a call that waits for the user's OK is open.
   */
  let {
    group,
    running,
    post,
  }: {
    group: Extract<ConversationItem, { kind: "group" }>;
    running: boolean;
    post: (message: Record<string, unknown>) => void;
  } = $props();

  /** Opened or closed by the user; otherwise open only while a call waits for them. */
  let chosen = $state<boolean | null>(null);
  const open = $derived(chosen ?? group.awaiting);
  const failed = $derived(group.failed > 0);
  const line = $derived(stepsLine(group.steps, running));
</script>

<div class="group" class:failed>
  <button
    class="summary"
    aria-expanded={open}
    aria-label={`${line} (${group.steps.length} steps)`}
    onclick={() => (chosen = !open)}
  >
    <span class="status" aria-hidden="true">
      {#if running}<span class="codicon codicon-loading codicon-modifier-spin"
        ></span>
      {:else if failed}<span class="codicon codicon-warning"></span>
      {:else}<span class="codicon codicon-check"></span>{/if}
    </span>
    <span class="line" class:working={running}>{line}</span>
    <span class="count"
      >{group.steps.length} {group.steps.length === 1 ? "step" : "steps"}</span
    >
    <span
      class="codicon codicon-chevron-{open ? 'up' : 'down'} chevron"
      aria-hidden="true"
    ></span>
  </button>
  {#if open}
    <div class="body">
      {#each group.steps as step (step.id)}
        {#if step.kind === "thinking"}
          <details class="thinking">
            <summary>
              <span class="codicon codicon-lightbulb" aria-hidden="true"></span>
              {#if running && step.durationMs === undefined}Thinking
              {:else}{thoughtFor(step.durationMs ?? null)}{/if}
            </summary>
            <p>{step.text}</p>
          </details>
        {:else}
          <ToolCard item={step} {post} />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .group {
    min-width: 0;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-width: 0;
    padding: 0.15rem 0;
    border: 0;
    background: none;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      color: var(--nova-fg);
    }
  }

  .status {
    display: grid;
    place-items: center;
    width: 0.9rem;
    flex: none;
    color: var(--nova-success);

    .group.failed & {
      color: var(--nova-warning);
    }
  }

  .line {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nova-fg) 8%, transparent);
    font-size: 0.72rem;
  }

  .chevron {
    flex: none;
    font-size: 0.7rem;
    opacity: 0;
  }

  .summary:hover .chevron,
  .summary:focus-visible .chevron,
  .summary[aria-expanded="true"] .chevron {
    opacity: 1;
  }

  .body {
    display: grid;
    gap: 0.4rem;
    margin: 0.25rem 0 0.5rem 0.4rem;
    padding: 0.15rem 0 0.15rem 0.85rem;
    border-left: 2px solid var(--nova-subtle-border);
    max-height: 26rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .thinking {
    color: var(--nova-muted);

    summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    p {
      margin-top: 4px;
      padding-left: 10px;
      border-left: 2px solid var(--nova-subtle-border);
      white-space: pre-wrap;
      font-size: 0.92em;
    }
  }

  /* A light sweep over the label while the model works. */
  .working {
    background: linear-gradient(
        90deg,
        var(--nova-muted) 0%,
        var(--nova-fg) 50%,
        var(--nova-muted) 100%
      )
      0 0 / 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: sweep 1.6s linear infinite;
  }

  @keyframes sweep {
    to {
      background-position: -200% 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .working {
      animation: none;
      color: inherit;
    }
  }
</style>
