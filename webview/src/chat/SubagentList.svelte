<script lang="ts">
    import type {SubagentState} from '../../../src/panel/protocol';

    let {agents, post, onOpen}: {
        agents: SubagentState[];
        post: (message: Record<string, unknown>) => void;
        /** A row was clicked: show that agent in the overlay. */
        onOpen: (agent: SubagentState) => void;
    } = $props();

    let now = $state(Date.now());

    const live = (agent: SubagentState) => agent.status === 'queued' || agent.status === 'running' || agent.status === 'waiting-approval';
    const anyLive = $derived(agents.some(live));

    // The elapsed times tick only while an agent works.
    $effect(() => {
        if (!anyLive) {
            return;
        }
        const timer = setInterval(() => now = Date.now(), 1000);
        return () => clearInterval(timer);
    });

    const icon = (status: SubagentState['status']) => ({
        queued: 'clock',
        running: 'loading codicon-modifier-spin',
        'waiting-approval': 'shield',
        done: 'check',
        error: 'error',
        stopped: 'debug-stop'
    }[status]);

    function elapsed(agent: SubagentState): string {
        if (!agent.startedAt) {
            return '';
        }
        const seconds = Math.max(0, Math.round(((agent.endedAt ?? now) - agent.startedAt) / 1000));
        return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
    }

    function tokens(count: number): string {
        return count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
    }
</script>

<ul class="agents">
    {#each agents as agent (agent.id)}
        <li class={`agent ${agent.status}`}>
            <div class="row">
                <button class="head" onclick={() => onOpen(agent)} title="Show what this agent is doing" aria-haspopup="dialog">
                    <span class={`codicon codicon-${icon(agent.status)} status`} aria-hidden="true"></span>
                    <span class="name">{agent.name}</span>
                    <span class="now">
                        {#if agent.status === 'waiting-approval'}Waiting for your OK
                        {:else if agent.status === 'queued'}Queued
                        {:else if agent.status === 'running'}{agent.currentTool ?? 'Thinking'}
                        {:else if agent.status === 'stopped'}Stopped
                        {:else if agent.status === 'error'}Failed
                        {:else}Done{/if}
                    </span>
                    <span class="stats">
                        {#if agent.toolCount}<span title="Tool calls"><span class="codicon codicon-tools" aria-hidden="true"></span>{agent.toolCount}</span>{/if}
                        {#if agent.tokens}<span title="Tokens"><span class="codicon codicon-symbol-numeric" aria-hidden="true"></span>{tokens(agent.tokens)}</span>{/if}
                        {#if agent.startedAt}<span title="Time">{elapsed(agent)}</span>{/if}
                    </span>
                    <span class="codicon codicon-chevron-right chevron" aria-hidden="true"></span>
                </button>
                {#if live(agent)}
                    <button class="stop codicon codicon-debug-stop" title="Stop this agent" aria-label={`Stop ${agent.name}`}
                            onclick={() => post({command: 'chat/stopAgent', id: agent.id})}></button>
                {/if}
            </div>
        </li>
    {/each}
</ul>

<style lang="scss">
  .agents {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .agent {
    border-top: 1px solid var(--nova-subtle-border);

    &:first-child {
      border-top: 0;
    }
  }

  .row {
    display: flex;
    align-items: center;
  }

  .head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 8px;
    border: 0;
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .status,
  .chevron {
    flex: none;
    color: var(--nova-muted);
  }

  .running .status {
    color: var(--nova-brand-primary);
  }

  .waiting-approval .status {
    color: var(--nova-warning);
  }

  .done .status {
    color: var(--nova-success);
  }

  .error .status {
    color: var(--nova-error);
  }

  .name {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .now {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--nova-muted);
  }

  .waiting-approval .now {
    color: var(--nova-warning);
  }

  .stats {
    flex: none;
    display: flex;
    gap: 8px;
    color: var(--nova-muted);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;

    .codicon {
      margin-right: 2px;
      font-size: 12px;
      vertical-align: -1px;
    }
  }

  .stop {
    flex: none;
    margin-right: 4px;
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--nova-fg);
    }
  }

</style>
