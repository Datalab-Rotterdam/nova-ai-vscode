<script lang="ts">
  import archiveIcon from 'bootstrap-icons/icons/archive.svg?raw';
  import pencilIcon from 'bootstrap-icons/icons/pencil.svg?raw';
  import trashIcon from 'bootstrap-icons/icons/trash3.svg?raw';
  import IconButton from '../common/IconButton.svelte';

  export interface SessionRow {
    id: string;
    title: string;
    preview: string;
    updatedAt: string;
    archived: boolean;
  }

  export let item: SessionRow;
  export let active = false;
  export let onclick: ((event: MouseEvent) => void) | undefined;
  export let onrename: (() => void) | undefined;
  export let onarchive: (() => void) | undefined;
  export let ondelete: (() => void) | undefined;

  const formatRelative = (value: string) => {
    const delta = Date.now() - new Date(value).getTime();
    const hours = Math.max(1, Math.round(delta / 3_600_000));
    return hours < 24 ? `${hours} hr${hours === 1 ? '' : 's'} ago` : `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'} ago`;
  };
</script>

<button class={`session-item ${active ? 'active' : ''}`} {onclick} title={item.title}>
  <span class="bullet" aria-hidden="true"></span>
  <span class="copy">
    <strong>{item.title}</strong>
    <small>{formatRelative(item.updatedAt)}</small>
  </span>
  <span class="actions" onclick={(event) => event.stopPropagation()}>
    <IconButton title="Rename chat" icon={pencilIcon} onclick={onrename ? () => onrename() : undefined} />
    <IconButton title="Archive chat" icon={archiveIcon} onclick={onarchive ? () => onarchive() : undefined} />
    <IconButton title="Delete chat" icon={trashIcon} onclick={ondelete ? () => ondelete() : undefined} />
  </span>
</button>

<style lang="scss">
  .session-item {
    width: 100%;
    min-height: 74px;
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    text-align: left;
    color: var(--fg);
  }

  .session-item:hover {
    background: var(--hover-bg);
  }

  .session-item.active {
    background: var(--selected-bg);
    color: var(--accent-fg);
  }

  .bullet {
    width: 8px;
    height: 8px;
    margin-top: 8px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, currentColor 30%, transparent);
  }

  .copy {
    min-width: 0;
    display: grid;
    gap: var(--space-2);
  }

  strong,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
    font-weight: 620;
  }

  small {
    font-size: var(--font-meta);
    color: inherit;
    opacity: 0.78;
  }

  .actions {
    display: none;
    align-items: center;
    gap: var(--space-1);
  }

  .session-item:hover .actions,
  .session-item.active .actions {
    display: inline-flex;
  }
</style>
