<script lang="ts">
  import type { ChatRenderMessage } from '../../../../src/chat/ChatService';
  import MessageBubble from './MessageBubble.svelte';
  import TraceItem from './TraceItem.svelte';
  import ToolLiveConsole from './ToolLiveConsole.svelte';

  export let messages: ChatRenderMessage[] = [];
  export let expanded = new Set<string>();
  export let ontoggleTrace: ((id: string) => void) | undefined;
  export let activeToolId: string | undefined = undefined;
  export let onusercontextmenu: ((message: ChatRenderMessage, event: MouseEvent) => void) | undefined;
</script>

<div class="message-list">
  {#each messages as message (message.id)}
    {#if message.role === 'assistant' || message.role === 'user' || message.role === 'status'}
      <MessageBubble {message} {onusercontextmenu} />
    {:else}
      <div class="trace-stack">
        <TraceItem message={message} expanded={expanded.has(message.id)} ontoggle={ontoggleTrace} />
        {#if message.role === 'tool' && activeToolId === message.id && (message.pending || message.status === 'running')}
          <ToolLiveConsole {message} />
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style lang="scss">
  .message-list {
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }

  .trace-stack {
    display: grid;
    gap: var(--space-3);
  }
</style>
