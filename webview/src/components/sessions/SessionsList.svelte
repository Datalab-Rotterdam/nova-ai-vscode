<script lang="ts">
  import SectionHeader from '../common/SectionHeader.svelte';
  import SessionItem, { type SessionRow } from './SessionItem.svelte';

  export let activeChatId = '';
  export let sessions: SessionRow[] = [];
  export let onswitch: ((id: string) => void) | undefined;
  export let onrename: ((id: string) => void) | undefined;
  export let onarchive: ((id: string) => void) | undefined;
  export let ondelete: ((id: string) => void) | undefined;

  $: liveSessions = sessions.filter((item) => !item.archived);
  $: archivedSessions = sessions.filter((item) => item.archived);
</script>

<div class="sessions-list">
  <SectionHeader label="Chat" />
  <SectionHeader label="Sessions" count={liveSessions.length} />
  <div class="stack">
    {#each liveSessions as item}
      <SessionItem
        {item}
        active={item.id === activeChatId}
        onclick={() => onswitch?.(item.id)}
        onrename={() => onrename?.(item.id)}
        onarchive={() => onarchive?.(item.id)}
        ondelete={() => ondelete?.(item.id)}
      />
    {/each}
  </div>

  <SectionHeader label="More" count={archivedSessions.length} />
  <div class="stack">
    {#each archivedSessions as item}
      <SessionItem
        {item}
        active={item.id === activeChatId}
        onclick={() => onswitch?.(item.id)}
        onrename={() => onrename?.(item.id)}
        onarchive={() => onarchive?.(item.id)}
        ondelete={() => ondelete?.(item.id)}
      />
    {/each}
  </div>
</div>

<style lang="scss">
  .sessions-list {
    display: grid;
    gap: var(--space-4);
  }

  .stack {
    display: grid;
    gap: var(--space-2);
  }
</style>
