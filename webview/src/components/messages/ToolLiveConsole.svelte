<script lang="ts">
  import { tick } from 'svelte';
  import type { ChatRenderMessage } from '../../../../src/chat/ChatService';

  export let message: ChatRenderMessage;

  let outputElement: HTMLPreElement | undefined;

  $: void scrollOutput(message.details, message.pending, message.status);

  async function scrollOutput(_details: string | undefined, _pending: boolean | undefined, _status: string | undefined) {
    await tick();
    if (message.pending || message.status === 'running') {
      outputElement?.scrollTo({ top: outputElement.scrollHeight });
    }
  }
</script>

<section class={`tool-console ${message.error ? 'error' : ''}`}>
  <header>
    <div class="copy">
      <strong>{message.name ?? 'Tool call'}</strong>
      <span>{message.pending || message.status === 'running' ? 'Running' : message.error ? 'Failed' : 'Complete'}</span>
    </div>
    {#if message.meta}
      <span class="meta">{message.meta}</span>
    {/if}
  </header>

  {#if message.inputText}
    <div class="segment">
      <span>Input</span>
      <pre>{message.inputText}</pre>
    </div>
  {/if}

  <div class="segment">
    <span>Output</span>
    <pre bind:this={outputElement}>{message.details || (message.pending ? 'Waiting for output…' : '')}</pre>
  </div>
</section>

<style lang="scss">
  .tool-console {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--divider);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--panel-elevated-bg) 88%, black 12%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 4%, transparent);
  }

  .tool-console.error {
    border-color: color-mix(in srgb, var(--danger) 42%, var(--divider));
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .copy {
    display: grid;
    gap: var(--space-1);
  }

  strong,
  .meta,
  .segment > span,
  .copy span {
    font-size: var(--font-meta);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  strong {
    color: var(--fg);
  }

  .meta,
  .segment > span,
  .copy span {
    color: var(--muted);
  }

  .segment {
    display: grid;
    gap: var(--space-2);
  }

  pre {
    max-height: 144px;
    margin: 0;
    padding: var(--space-4);
    overflow: auto;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, black 24%, var(--panel-elevated-bg));
    color: var(--fg);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.4;
  }
</style>
