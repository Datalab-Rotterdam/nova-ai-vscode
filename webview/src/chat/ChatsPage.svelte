<script lang="ts">
    import {onMount, tick} from 'svelte';
    import type {SessionSummary} from '../../../src/panel/protocol';
    import {filterChats, formatAge, groupChats} from '../../../src/panel/chatGroups';

    let {sessions, currentId, running, post, onClose}: {
        sessions: SessionSummary[];
        currentId: string;
        running: boolean;
        post: (message: Record<string, unknown>) => void;
        onClose: () => void;
    } = $props();

    const MAX_TITLE_LENGTH = 200;

    let query = $state('');
    let now = $state(Date.now());
    /** The row the arrow keys move; Enter opens it. */
    let activeId = $state<string | undefined>();
    let editingId = $state<string | undefined>();
    let editValue = $state('');
    let search: HTMLInputElement | undefined = $state();
    let listElement: HTMLElement | undefined = $state();

    const filtered = $derived(filterChats(sessions, query));
    const groups = $derived(groupChats(filtered, now));
    /** Rows in display order, for keyboard navigation. */
    const ordered = $derived(groups.flatMap((group) => group.chats));

    onMount(() => {
        search?.focus();
        // Ages ("5m", "Today") stay right while the page is open.
        const timer = setInterval(() => (now = Date.now()), 60_000);
        return () => clearInterval(timer);
    });

    // Keep the active row on a visible chat when the list or the filter changes.
    $effect(() => {
        if (!ordered.some((chat) => chat.id === activeId)) {
            activeId = ordered[0]?.id;
        }
    });

    function open(chat: SessionSummary) {
        if (chat.id === currentId) {
            onClose();
            return;
        }
        post({command: 'chat/open', sessionId: chat.id});
        // While Nova works the extension refuses to switch (and says why): stay on the list.
        if (!running) {
            onClose();
        }
    }

    function remove(ids: string[]) {
        // The extension asks for confirmation.
        post({command: 'chat/delete', sessionIds: ids});
    }

    async function startRename(chat: SessionSummary) {
        editingId = chat.id;
        editValue = chat.title;
        await tick();
        const input = listElement?.querySelector<HTMLInputElement>('input.rename');
        input?.focus();
        input?.select();
    }

    function commitRename() {
        const chat = sessions.find((candidate) => candidate.id === editingId);
        const title = editValue.trim();
        if (chat && title && title !== chat.title) {
            post({command: 'chat/rename', sessionId: chat.id, title});
        }
        editingId = undefined;
        search?.focus();
    }

    function cancelRename() {
        editingId = undefined;
        search?.focus();
    }

    async function moveActive(step: number) {
        if (!ordered.length) {
            return;
        }
        const index = ordered.findIndex((chat) => chat.id === activeId);
        const next = Math.min(ordered.length - 1, Math.max(0, (index < 0 ? -1 : index) + step));
        activeId = ordered[next].id;
        await tick();
        listElement?.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({block: 'nearest'});
    }

    function onSearchKey(event: KeyboardEvent) {
        const active = ordered.find((chat) => chat.id === activeId);
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                void moveActive(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                void moveActive(-1);
                break;
            case 'PageDown':
                event.preventDefault();
                void moveActive(10);
                break;
            case 'PageUp':
                event.preventDefault();
                void moveActive(-10);
                break;
            case 'Enter':
                event.preventDefault();
                if (active) {
                    open(active);
                }
                break;
            case 'F2':
                event.preventDefault();
                if (active) {
                    void startRename(active);
                }
                break;
            case 'Delete':
                // Only with an empty search box, where Delete has nothing else to do.
                if (active && !query) {
                    event.preventDefault();
                    remove([active.id]);
                }
                break;
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                if (query) {
                    query = '';
                } else {
                    onClose();
                }
                break;
        }
    }

    function onRenameKey(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitRename();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelRename();
        }
    }

    function fullDate(time: number): string {
        return new Date(time).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
    }
</script>

<!-- Esc from anywhere on the page (a row, a button) goes back to the chat. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="chats-page" role="region" aria-label="Chats" onkeydown={(event) => { if (event.key === 'Escape' && !editingId) { event.preventDefault(); onClose(); } }}>
    <div class="search">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input
            bind:this={search}
            bind:value={query}
            type="text"
            placeholder="Search chats"
            aria-label="Search chats"
            aria-controls="nova-chat-list"
            aria-activedescendant={activeId ? `chat-${activeId}` : undefined}
            onkeydown={onSearchKey}
        />
        {#if query}
            <button class="icon codicon codicon-close" title="Clear search" aria-label="Clear search" onclick={() => { query = ''; search?.focus(); }}></button>
        {/if}
    </div>

    <div class="list" id="nova-chat-list" role="listbox" aria-label="Chats" bind:this={listElement}>
        {#each groups as group (group.key)}
            <div class="group" role="group" aria-label={group.label}>
                <div class="group-header">
                    <span class="group-label">{group.label}</span>
                    <span class="group-count">{group.chats.length}</span>
                    {#if !query}
                        <button
                            class="icon codicon codicon-trash group-delete"
                            title={`Delete all ${group.chats.length} chats in ${group.label}`}
                            aria-label={`Delete all chats in ${group.label}`}
                            onclick={() => remove(group.chats.map((chat) => chat.id))}
                        ></button>
                    {/if}
                </div>
                {#each group.chats as chat (chat.id)}
                    {@const current = chat.id === currentId}
                    {@const working = current && running}
                    <div
                        class="row"
                        class:current
                        class:active={chat.id === activeId}
                        id={`chat-${chat.id}`}
                        data-id={chat.id}
                        role="option"
                        aria-selected={chat.id === activeId}
                        aria-current={current ? 'true' : undefined}
                    >
                        {#if editingId === chat.id}
                            <input
                                class="rename"
                                bind:value={editValue}
                                maxlength={MAX_TITLE_LENGTH}
                                aria-label="Chat name"
                                onkeydown={onRenameKey}
                                onblur={commitRename}
                            />
                        {:else}
                            <button
                                class="open"
                                title={`${chat.title}\nLast used ${fullDate(chat.updatedAt)}`}
                                onclick={() => open(chat)}
                                ondblclick={() => startRename(chat)}
                            >
                                <span class="marker" aria-hidden="true">
                                    {#if working}
                                        <span class="codicon codicon-loading spin"></span>
                                    {:else if current}
                                        <span class="dot"></span>
                                    {/if}
                                </span>
                                <span class="chat-title">{chat.title || 'Untitled chat'}</span>
                                <span class="age">{working ? 'working…' : current ? 'open' : formatAge(chat.updatedAt, now)}</span>
                            </button>
                            <span class="actions">
                                <button class="icon codicon codicon-edit" title="Rename (F2)" aria-label={`Rename ${chat.title}`} onclick={() => startRename(chat)}></button>
                                <button class="icon codicon codicon-trash" title="Delete" aria-label={`Delete ${chat.title}`} onclick={() => remove([chat.id])}></button>
                            </span>
                        {/if}
                    </div>
                {/each}
            </div>
        {/each}

        {#if !sessions.length}
            <div class="empty">
                <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
                <p>No chats in this workspace yet.</p>
            </div>
        {:else if !filtered.length}
            <div class="empty">
                <p>No chats match “{query}”.</p>
            </div>
        {/if}
    </div>

    <div class="footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>F2</kbd> rename</span>
        <span><kbd>Esc</kbd> back</span>
    </div>
</div>

<style lang="scss">
  .chats-page {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    background: var(--nova-bg);
  }

  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 12px;
    padding: 0 6px 0 8px;
    border: 1px solid var(--nova-input-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-input-bg);
    color: var(--nova-input-fg);

    &:focus-within {
      border-color: var(--nova-focus);
    }

    .codicon-search {
      color: var(--nova-muted);
    }

    input {
      flex: 1;
      min-width: 0;
      padding: 6px 0;
      border: 0;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;

      &::placeholder {
        color: var(--nova-input-placeholder);
      }
    }
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 8px;
  }

  .group-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 4px;
    background: var(--nova-bg);
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    .group-count {
      font-weight: 400;
      opacity: 0.8;
    }

    .group-delete {
      margin-left: auto;
      visibility: hidden;
    }

    &:hover .group-delete,
    .group-delete:focus-visible {
      visibility: visible;
    }
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    margin: 0 6px;
    border-radius: var(--nova-radius);

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-hover-fg);
    }

    &.active {
      background: var(--vscode-list-inactiveSelectionBackground, var(--nova-hover));
      color: var(--vscode-list-inactiveSelectionForeground, inherit);
    }

    &.current .chat-title {
      font-weight: 600;
    }

    .actions {
      display: flex;
      flex: none;
      gap: 2px;
      padding-right: 4px;
      visibility: hidden;
    }

    &:hover .actions,
    &.active .actions,
    .actions:focus-within {
      visibility: visible;
    }
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: -1px;
      border-radius: var(--nova-radius);
    }
  }

  .marker {
    flex: none;
    display: grid;
    place-items: center;
    width: 14px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--nova-link);
  }

  .spin {
    font-size: 12px;
    color: var(--nova-link);
    animation: nova-spin 1s linear infinite;
  }

  @keyframes nova-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  .chat-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .age {
    flex: none;
    color: var(--nova-muted);
    font-size: 0.85em;
  }

  .row.current .age {
    color: var(--nova-link);
  }

  .rename {
    flex: 1;
    min-width: 0;
    margin: 2px 4px 2px 20px;
    padding: 3px 6px;
    border: 1px solid var(--nova-focus);
    border-radius: var(--nova-radius);
    outline: none;
    background: var(--nova-input-bg);
    color: var(--nova-input-fg);
    font: inherit;
  }

  .icon {
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

  .empty {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 32px 16px;
    color: var(--nova-muted);
    text-align: center;

    .codicon {
      font-size: 24px;
    }

    p {
      margin: 0;
    }
  }

  .footer {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 6px 12px;
    border-top: 1px solid var(--nova-border);
    color: var(--nova-muted);
    font-size: 0.8em;

    kbd {
      margin-right: 2px;
      padding: 0 4px;
      border: 1px solid var(--nova-subtle-border);
      border-radius: 3px;
      font: inherit;
    }
  }
</style>
