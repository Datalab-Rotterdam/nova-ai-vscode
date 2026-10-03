<script lang="ts">
    import type {TodoItem} from '../../../src/panel/protocol';

    let {todos, running, post}: { todos: TodoItem[]; running: boolean; post: (message: Record<string, unknown>) => void } = $props();

    let expanded = $state(false);

    const done = $derived(todos.filter((todo) => todo.status === 'completed').length);
    const current = $derived(todos.find((todo) => todo.status === 'in_progress'));
    const finished = $derived(done === todos.length);
    const summary = $derived(finished ? 'All tasks done' : current?.content ?? todos.find((todo) => todo.status === 'pending')?.content ?? '');
</script>

<!-- A one-line strip above the composer; expands in place (height-capped) so the chat stays visible. -->
<section class="todos" class:expanded aria-label="Nova's task list">
    <div class="bar">
        <button class="toggle" onclick={() => expanded = !expanded} aria-expanded={expanded} title={expanded ? 'Collapse task list' : 'Show all tasks'}>
            <span class={`codicon codicon-${finished ? 'pass-filled' : running ? 'loading codicon-modifier-spin' : 'checklist'}`} aria-hidden="true"></span>
            <span class="count">{done}/{todos.length}</span>
            <span class="summary">{summary}</span>
            <span class="progress" aria-hidden="true"><span style:width={`${(done / Math.max(1, todos.length)) * 100}%`}></span></span>
            <span class={`codicon codicon-chevron-${expanded ? 'down' : 'up'}`} aria-hidden="true"></span>
        </button>
        <button class="close codicon codicon-close" title="Close task list" aria-label="Close task list" onclick={() => post({command: 'chat/dismissTodos'})}></button>
    </div>

    {#if expanded}
        <ol>
            {#each todos as todo, index (index)}
                <li class={todo.status}>
                    <span class={`codicon codicon-${todo.status === 'completed' ? 'pass' : todo.status === 'in_progress' ? 'circle-filled' : 'circle-large-outline'}`} aria-hidden="true"></span>
                    <span>{todo.content}</span>
                </li>
            {/each}
        </ol>
    {/if}
</section>

<style lang="scss">
  .todos {
    flex: none;
    margin: 0 10px 6px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 10px;
    background: var(--nova-surface);
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
  }

  .toggle {
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

    > .codicon {
      flex: none;
      color: var(--nova-muted);
    }

    .codicon-pass-filled {
      color: var(--nova-success);
    }
  }

  .count {
    flex: none;
    color: var(--nova-muted);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress {
    flex: none;
    width: 40px;
    height: 3px;
    border-radius: 2px;
    background: var(--nova-subtle-border);
    overflow: hidden;

    span {
      display: block;
      height: 100%;
      background: var(--nova-brand-primary);
      transition: width 0.3s ease;
    }
  }

  .close {
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

  ol {
    max-height: 30vh;
    margin: 0;
    padding: 2px 10px 6px;
    overflow-y: auto;
    list-style: none;
    border-top: 1px solid var(--nova-subtle-border);

    li {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 2px 0;

      .codicon {
        flex: none;
        margin-top: 2px;
        font-size: 13px;
        color: var(--nova-muted);
      }

      &.completed {
        color: var(--nova-muted);
        text-decoration: line-through;

        .codicon {
          color: var(--nova-success);
        }
      }

      &.in_progress {
        font-weight: 600;

        .codicon {
          color: var(--nova-brand-primary);
        }
      }
    }
  }
</style>
