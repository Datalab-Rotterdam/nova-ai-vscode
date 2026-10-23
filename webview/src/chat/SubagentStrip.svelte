<script lang="ts">
    import type {ChatItem, SubagentState} from '../../../src/panel/protocol';
    import SubagentList from './SubagentList.svelte';
    import SubagentOverlay from './SubagentOverlay.svelte';

    let {agents, items, post}: {
        agents: SubagentState[];
        items: ChatItem[];
        post: (message: Record<string, unknown>) => void;
    } = $props();

    /** Opened or closed by the user; otherwise open while any agent works. */
    let chosen = $state<boolean | null>(null);
    /** The agent shown in the overlay; read from `agents` so the overlay follows its updates. */
    let selectedId = $state<string | undefined>();
    const selected = $derived(agents.find((agent) => agent.id === selectedId));

    const live = (agent: SubagentState) => agent.status === 'queued' || agent.status === 'running' || agent.status === 'waiting-approval';
    const active = $derived(agents.filter(live).length);
    const waiting = $derived(agents.some((agent) => agent.status === 'waiting-approval'));
    const open = $derived(chosen ?? (active > 0));
    const failed = $derived(agents.filter((agent) => agent.status === 'error').length);
    const summary = $derived(active
        ? `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'} · ${active} working`
        : `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'} finished${failed ? ` · ${failed} failed` : ''}`);
</script>

<!-- Above the composer: one segment per agent gives the overview at a glance; the list opens below it. -->
<section class="subagents" aria-label="Agents">
    <button class="bar" onclick={() => chosen = !open} aria-expanded={open} title={open ? 'Hide agents' : 'Show agents'}>
        <span class={`codicon codicon-${active ? 'loading codicon-modifier-spin' : failed ? 'warning' : 'pass-filled'} lead`} class:done={!active && !failed} aria-hidden="true"></span>
        <span class="summary">{summary}</span>
        {#if waiting}<span class="badge">needs your OK</span>{/if}
        <span class="segments" aria-hidden="true">
            {#each agents as agent (agent.id)}
                <span class={`segment ${agent.status}`}></span>
            {/each}
        </span>
        <span class={`codicon codicon-chevron-${open ? 'down' : 'up'}`} aria-hidden="true"></span>
    </button>
    {#if open}
        <div class="list"><SubagentList {agents} {post} onOpen={(agent) => selectedId = agent.id}/></div>
    {/if}
</section>

{#if selected}
    <SubagentOverlay agent={selected} {items} {post} onClose={() => selectedId = undefined}/>
{/if}

<style lang="scss">
  .subagents {
    flex: none;
    margin: 0 10px 6px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 10px;
    background: var(--nova-surface);
    overflow: hidden;
  }

  .bar {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    .codicon {
      flex: none;
      color: var(--nova-muted);
    }

    .lead.done {
      color: var(--nova-success);
    }
  }

  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--nova-warning);
    color: var(--nova-bg);
    font-size: 0.85em;
  }

  .segments {
    flex: none;
    display: flex;
    gap: 2px;
  }

  .segment {
    width: 14px;
    height: 4px;
    border-radius: 2px;
    background: var(--nova-subtle-border);
    transition: background 0.3s ease;

    &.running {
      background: var(--nova-brand-primary);
      animation: pulse 1.2s ease-in-out infinite;
    }

    &.waiting-approval {
      background: var(--nova-warning);
    }

    &.done {
      background: var(--nova-success);
    }

    &.error {
      background: var(--nova-error);
    }

    &.stopped {
      background: var(--nova-muted);
    }
  }

  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .segment.running {
      animation: none;
    }
  }

  .list {
    max-height: 45vh;
    overflow-y: auto;
    border-top: 1px solid var(--nova-subtle-border);
  }
</style>
