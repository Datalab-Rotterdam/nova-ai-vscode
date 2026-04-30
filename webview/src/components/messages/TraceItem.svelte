<script lang="ts">
  import chevronRightIcon from 'bootstrap-icons/icons/chevron-right.svg?raw';
  import type { ChatRenderMessage } from '../../../../src/chat/ChatService';

  export let message: ChatRenderMessage;
  export let expanded = false;
  export let ontoggle: ((id: string) => void) | undefined;

  $: title = message.role === 'thinking' ? 'Thinking' : message.name ?? 'Tool call';
  $: statusLabel = message.pending || message.status === 'running'
    ? 'Running'
    : message.error || message.status === 'error'
      ? 'Failed'
      : message.meta ?? 'Done';
  $: isLoading = message.pending || message.status === 'running';
  $: hasContent = !!message.inputText || !!message.details;
</script>

<details class={`trace ${message.role} ${message.error ? 'error' : ''} ${isLoading ? 'running' : ''}`} open={expanded}>
  <summary onclick={(event) => {
    event.preventDefault();
    ontoggle?.(message.id);
  }}>
    <span class="lead">
      <span class={`chevron ${expanded ? 'open' : ''}`} aria-hidden="true">{@html chevronRightIcon}</span>
      <span class="title">{title}</span>
      {#if isLoading}
        <span class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      {/if}
    </span>
    <span class="meta">{statusLabel}</span>
  </summary>

  {#if hasContent}
    {#if message.inputText}
      <div class="block">
        <span>Input</span>
        <pre>{message.inputText}</pre>
      </div>
    {/if}

    {#if message.details}
      <div class="block">
        <span>{message.role === 'thinking' ? 'Content' : 'Output'}</span>
        <pre>{message.details}</pre>
      </div>
    {/if}
  {/if}
</details>

<style lang="scss">
  .trace {
    border: 1px solid var(--divider);
    border-radius: var(--radius-lg);
    background: var(--trace-bg);
    overflow: hidden;
  }

  .trace.thinking {
    background: var(--trace-thinking-bg);
  }

  .trace.error {
    background: var(--trace-error-bg);
    border-color: color-mix(in srgb, var(--danger) 42%, var(--divider));
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 36px;
    padding: var(--space-3) var(--space-5);
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .lead {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }

  .title,
  .meta,
  .block > span {
    font-size: var(--font-meta);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .meta,
  .block > span {
    color: var(--muted);
  }

  .chevron {
    display: inline-grid;
    place-items: center;
    color: var(--muted);
    transition: transform 120ms ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .chevron :global(svg) {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  .loading-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .loading-dots span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: var(--muted);
    animation: pulse 1.1s ease-in-out infinite;
  }

  .loading-dots span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .loading-dots span:nth-child(3) {
    animation-delay: 0.3s;
  }

  .block {
    display: grid;
    gap: var(--space-2);
    padding: 0 var(--space-5) var(--space-4);
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--fg);
  }

  @keyframes pulse {
    0%,
    80%,
    100% {
      opacity: 0.3;
      transform: scale(0.85);
    }

    40% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
