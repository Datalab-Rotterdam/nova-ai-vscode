<script lang="ts">
  export let title = '';
  export let ariaLabel = '';
  export let icon = '';
  export let disabled = false;
  export let active = false;
  export let onclick: ((event: MouseEvent) => void) | undefined;
</script>

<button
  class={`ui-icon-button ${active ? 'active' : ''}`}
  title={title}
  aria-label={ariaLabel || title}
  disabled={disabled}
  {onclick}
>
  {@html icon}
</button>

<style lang="scss">
  .active {
    background: var(--selected-bg);
    color: var(--accent-fg);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
