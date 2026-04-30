<script lang="ts">
  import { renderMarkdown } from '../../lib/markdown';
  import type { ChatRenderMessage } from '../../../../src/chat/ChatService';

  export let message: ChatRenderMessage;
  export let onusercontextmenu: ((message: ChatRenderMessage, event: MouseEvent) => void) | undefined;
</script>

<article
  class={`message ${message.role} ${message.error ? 'error' : ''}`}
  oncontextmenu={(event) => {
    if (message.role === 'user') {
      event.preventDefault();
      onusercontextmenu?.(message, event);
    }
  }}
>
  <header>
    <span class="role">{message.role === 'assistant' ? 'Nova' : message.role === 'user' ? 'You' : 'Status'}</span>
    {#if message.meta}
      <span class="meta">{message.meta}</span>
    {/if}
  </header>

  {#if message.markdown}
    <div class="markdown">{@html renderMarkdown(message.text || ' ')}</div>
  {:else}
    <pre>{message.text || ' '}</pre>
  {/if}
</article>

<style lang="scss">
  .message {
    max-width: min(86%, 720px);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--divider);
    border-radius: var(--radius-lg);
    background: var(--panel-soft-bg);
    justify-self: start;
  }

  .message.user {
    justify-self: end;
    background: var(--selected-bg);
    color: var(--accent-fg);
    border-color: transparent;
  }

  .message.status {
    max-width: 100%;
    justify-self: stretch;
    background: transparent;
    border-style: dashed;
  }

  .message.error {
    border-color: color-mix(in srgb, var(--danger) 42%, var(--divider));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .role,
  .meta {
    font-size: var(--font-meta);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .meta {
    color: var(--muted);
  }

  .message.user .meta,
  .message.user :global(a),
  .message.user :global(blockquote) {
    color: color-mix(in srgb, var(--accent-fg) 78%, white 22%);
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--fg);
  }

  .markdown {
    color: var(--fg);
    font-size: var(--font-body);
    line-height: 1.5;
  }

  .message.user .markdown {
    color: var(--accent-fg);
  }

  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(pre),
  .markdown :global(blockquote) {
    margin: 0 0 0.65rem;
  }

  .markdown :global(p:last-child),
  .markdown :global(ul:last-child),
  .markdown :global(ol:last-child),
  .markdown :global(pre:last-child),
  .markdown :global(blockquote:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(code) {
    padding: 0.08rem 0.32rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .markdown :global(pre code) {
    display: block;
    padding: var(--space-4);
    overflow: auto;
    background: var(--trace-bg);
  }

  .markdown :global(blockquote) {
    padding-left: var(--space-4);
    border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--muted);
  }
</style>
