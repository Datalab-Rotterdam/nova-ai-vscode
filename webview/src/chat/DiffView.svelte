<script lang="ts">
    import type {DiffLine} from '../../../src/panel/protocol';

    let {lines, collapsedLines = 12, truncated = false, onOpen}: {
        lines: DiffLine[];
        collapsedLines?: number;
        truncated?: boolean;
        /** Opens the full diff in a VS Code diff editor. */
        onOpen?: () => void;
    } = $props();

    let expanded = $state(false);
    const shown = $derived(expanded ? lines : lines.slice(0, collapsedLines));
    const hidden = $derived(lines.length - shown.length);
</script>

<!-- Unified diff with old/new line numbers, colored like VS Code's diff editor. -->
<div class="diff-wrap">
{#if onOpen}
    <button class="open" onclick={onOpen} title="Open in diff editor" aria-label="Open in diff editor">
        <span class="codicon codicon-screen-full" aria-hidden="true"></span>
    </button>
{/if}
<div class="diff" role="table" aria-label="Changes">
    {#each shown as line, index (index)}
        {#if line.type === 'hunk'}
            <div class="row hunk" role="row"><span class="text">{line.text}</span></div>
        {:else}
            <div class={`row ${line.type}`} role="row">
                <span class="no">{line.oldNo ?? ''}</span>
                <span class="no">{line.newNo ?? ''}</span>
                <span class="sign" aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
                <span class="text">{line.text}</span>
            </div>
        {/if}
    {/each}
</div>
</div>
{#if hidden > 0 || (expanded && lines.length > collapsedLines)}
    <button class="more" onclick={() => expanded = !expanded}>
        {expanded ? 'Show less' : `Show ${hidden} more line${hidden === 1 ? '' : 's'}`}
    </button>
{/if}
{#if expanded && truncated}
    <p class="truncated">Diff cut off; open the diff for the full change.</p>
{/if}

<style lang="scss">
  .diff-wrap {
    position: relative;

    &:hover .open,
    .open:focus-visible {
      opacity: 1;
    }
  }

  .open {
    position: absolute;
    top: 3px;
    right: 3px;
    z-index: 1;
    padding: 3px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: var(--vscode-editorWidget-background, var(--nova-input-bg));
    color: var(--nova-fg);
    cursor: pointer;
    opacity: 0.6;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }
  }

  .diff {
    overflow-x: auto;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: var(--vscode-editor-background, var(--nova-input-bg));
    font-family: var(--nova-mono);
    font-size: var(--vscode-editor-font-size, 12px);
    line-height: 1.45;
  }

  .row {
    display: grid;
    grid-template-columns: 3ch 3ch 2ch 1fr;
    min-width: max-content;
    white-space: pre;
  }

  .no {
    padding-right: 4px;
    color: var(--vscode-editorLineNumber-foreground, var(--nova-muted));
    text-align: right;
    user-select: none;
  }

  .sign {
    text-align: center;
    user-select: none;
  }

  .text {
    padding-right: 8px;
  }

  .add {
    background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));

    .sign {
      color: var(--vscode-gitDecoration-addedResourceForeground, var(--nova-success));
    }
  }

  .del {
    background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));

    .sign {
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--nova-error));
    }
  }

  .hunk {
    grid-template-columns: 1fr;
    padding-left: 8ch;
    background: color-mix(in srgb, var(--nova-focus) 8%, transparent);
    color: var(--nova-muted);
  }

  .more {
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-link);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  .truncated {
    margin: 2px 0 0;
    color: var(--nova-muted);
    font-size: 0.85em;
  }
</style>
