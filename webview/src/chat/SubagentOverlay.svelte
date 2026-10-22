<script lang="ts">
    import type {ChatItem, SubagentState, ToolItem} from '../../../src/panel/protocol';
    import Markdown from './Markdown.svelte';
    import ToolCard from './ToolCard.svelte';

    let {agent, items, post, onClose}: {
        agent: SubagentState;
        items: ChatItem[];
        post: (message: Record<string, unknown>) => void;
        onClose: () => void;
    } = $props();

    const live = $derived(agent.status === 'queued' || agent.status === 'running' || agent.status === 'waiting-approval');
    const steps = $derived(items.filter((item): item is ToolItem => item.kind === 'tool' && item.agentId === agent.id));
    const label = $derived({
        queued: 'Queued',
        running: agent.currentTool ?? 'Working',
        'waiting-approval': 'Waiting for your OK',
        done: 'Done',
        error: 'Failed',
        stopped: 'Stopped'
    }[agent.status]);

    let closeButton: HTMLButtonElement | undefined = $state();
    let body: HTMLDivElement | undefined = $state();

    $effect(() => closeButton?.focus());

    // Follow the agent while it works, unless the user scrolled up to read.
    $effect(() => {
        void steps.length;
        void agent.report;
        if (body && live && body.scrollHeight - body.scrollTop - body.clientHeight < 80) {
            body.scrollTop = body.scrollHeight;
        }
    });

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    }
</script>

<svelte:window onkeydowncapture={onKey}/>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(event) => event.target === event.currentTarget && onClose()}>
    <div class="panel" role="dialog" aria-modal="true" aria-label={`Agent ${agent.name}`}>
        <header>
            <span class={`dot ${agent.status}`} aria-hidden="true"></span>
            <div class="titles">
                <div class="name">{agent.name}</div>
                <div class="sub">{label}{agent.model ? ` · ${agent.model}` : ''} · {agent.toolCount} {agent.toolCount === 1 ? 'tool call' : 'tool calls'}</div>
            </div>
            {#if live}
                <button class="nova-button secondary" onclick={() => post({command: 'chat/stopAgent', id: agent.id})}>
                    <span class="codicon codicon-debug-stop" aria-hidden="true"></span> Stop
                </button>
            {/if}
            <button bind:this={closeButton} class="close codicon codicon-close" title="Close (Esc)" aria-label="Close" onclick={onClose}></button>
        </header>

        <div class="body" bind:this={body}>
            <section>
                <div class="label">Task</div>
                <p class="task">{agent.task}</p>
            </section>

            <section>
                <div class="label">Steps</div>
                {#if steps.length}
                    <div class="steps">
                        {#each steps as step (step.id)}
                            <ToolCard item={step} {post}/>
                        {/each}
                    </div>
                {:else}
                    <p class="empty">{agent.status === 'queued' ? 'Waiting for a free slot.' : live ? 'No tool calls yet.' : 'The agent made no tool calls.'}</p>
                {/if}
            </section>

            {#if agent.report}
                <section>
                    <div class="label">Report</div>
                    <div class="report"><Markdown text={agent.report}/></div>
                </section>
            {/if}
        </div>
    </div>
</div>

<style lang="scss">
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: color-mix(in srgb, var(--nova-bg) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .panel {
    width: min(720px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--nova-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-bg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--nova-subtle-border);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--nova-muted);

    &.running {
      background: var(--nova-brand-primary);
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
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .close {
    flex: none;
    padding: 4px;
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

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 12px;
    overflow-y: auto;
  }

  section {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .label {
    color: var(--nova-muted);
    font-size: 0.85em;
    text-transform: uppercase;
  }

  .task,
  .empty {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty {
    color: var(--nova-muted);
  }

  .steps {
    display: grid;
    gap: 4px;
  }

  .report {
    min-width: 0;
  }
</style>
