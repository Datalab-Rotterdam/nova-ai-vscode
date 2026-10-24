<script lang="ts">
    import type {DiffLine, FileChange} from '../../../src/panel/protocol';
    import DiffView from './DiffView.svelte';

    let {changes, hunks, post}: { changes: FileChange[]; hunks: Record<string, DiffLine[][]>; post: (message: Record<string, unknown>) => void } = $props();

    let expanded = $state(false);
    /** Files whose hunks are shown, to keep or undo them one by one. */
    let open = $state<Record<string, boolean>>({});

    function toggleHunks(path: string) {
        open[path] = !open[path];
        if (open[path]) {
            post({command: 'chat/changeHunks', path});
        }
    }
    const added = $derived(changes.reduce((total, change) => total + change.added, 0));
    const removed = $derived(changes.reduce((total, change) => total + change.removed, 0));

    function name(path: string): string {
        return path.split('/').pop() ?? path;
    }

    function folder(path: string): string {
        const parts = path.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    }
</script>

<!-- Like VS Code's chat working set: files Nova changed, waiting for Keep or Undo. -->
<section class="changes" aria-label="Files changed by Nova">
    <div class="bar">
        <button class="toggle" onclick={() => expanded = !expanded} aria-expanded={expanded}>
            <span class={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} aria-hidden="true"></span>
            <span>{changes.length} file{changes.length === 1 ? '' : 's'} changed</span>
            <span class="stat add">+{added}</span>
            <span class="stat del">−{removed}</span>
        </button>
        <button class="action" onclick={() => post({command: 'chat/keepChange'})} title="Keep all changes">Keep</button>
        <button class="action" onclick={() => post({command: 'chat/undoChange'})} title="Undo all changes">Undo</button>
    </div>

    {#if expanded}
        <ul>
            {#each changes as change (change.path)}
                <li>
                    <button class={`icon codicon codicon-chevron-${open[change.path] ? 'down' : 'right'}`} title="Show the changes to keep or undo them one by one"
                            aria-expanded={!!open[change.path]} aria-label={`Show changes in ${change.path}`} onclick={() => toggleHunks(change.path)}></button>
                    <button class="file" onclick={() => post({command: 'chat/openChangeDiff', path: change.path})} title={`Open diff of ${change.path}`}>
                        <span class="codicon codicon-{change.created ? 'new-file' : 'file'}" aria-hidden="true"></span>
                        <span class="name">{name(change.path)}</span>
                        <span class="folder">{folder(change.path)}</span>
                        <span class="stat add">+{change.added}</span>
                        <span class="stat del">−{change.removed}</span>
                    </button>
                    <button class="icon codicon codicon-check" title="Keep" aria-label={`Keep changes to ${change.path}`} onclick={() => post({command: 'chat/keepChange', path: change.path})}></button>
                    <button class="icon codicon codicon-discard" title={change.created ? 'Undo (delete file)' : 'Undo'} aria-label={`Undo changes to ${change.path}`} onclick={() => post({command: 'chat/undoChange', path: change.path})}></button>
                </li>
                {#if open[change.path]}
                    {#each hunks[change.path] ?? [] as hunk, index (`${change.path}:${index}:${hunk[0]?.text}`)}
                        <li class="hunk">
                            <div class="hunk-diff"><DiffView lines={hunk} collapsedLines={8}/></div>
                            <div class="hunk-actions">
                                <button class="icon codicon codicon-check" title="Keep this change" aria-label="Keep this change"
                                        onclick={() => post({command: 'chat/keepHunk', path: change.path, index})}></button>
                                <button class="icon codicon codicon-discard" title="Undo this change" aria-label="Undo this change"
                                        onclick={() => post({command: 'chat/undoHunk', path: change.path, index})}></button>
                            </div>
                        </li>
                    {/each}
                {/if}
            {/each}
        </ul>
    {/if}
</section>

<style lang="scss">
  .changes li.hunk {
    align-items: flex-start;
    padding-left: 22px;
  }

  .hunk-diff {
    flex: 1;
    min-width: 0;
  }

  .hunk-actions {
    flex: none;
    display: flex;
    flex-direction: column;
  }

  .changes {
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
    gap: 2px;
    padding-right: 4px;
  }

  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 0;
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    .codicon {
      color: var(--nova-muted);
    }
  }

  .stat {
    font-family: var(--nova-mono);
    font-size: 0.9em;

    &.add {
      color: var(--vscode-gitDecoration-addedResourceForeground, var(--nova-success));
    }

    &.del {
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--nova-error));
    }
  }

  .action {
    padding: 1px 8px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-fg);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }
  }

  ul {
    max-height: 30vh;
    margin: 0;
    padding: 2px 4px 4px;
    overflow-y: auto;
    list-style: none;
    border-top: 1px solid var(--nova-subtle-border);

    li {
      display: flex;
      align-items: center;
    }
  }

  .file {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--nova-hover);
    }

    .codicon {
      flex: none;
      color: var(--nova-muted);
    }
  }

  .name {
    flex: none;
  }

  .folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--nova-muted);
    font-size: 0.9em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    flex: none;
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
