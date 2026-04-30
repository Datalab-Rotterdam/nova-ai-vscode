<script lang="ts">
  export let label = '';
  export let secondaryLabel = '';
  export let icon = '';
  export let active = false;
  export let compact = false;
  export let disabled = false;
  export let onclick: ((event: MouseEvent) => void) | undefined;
</script>

<button
  class={`ui-pill-button ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}
  {onclick}
  {disabled}
>
  {#if icon}
    <span aria-hidden="true">{@html icon}</span>
  {/if}
  <span class="label">{label}</span>
  {#if secondaryLabel}
    <small>{secondaryLabel}</small>
  {/if}
</button>

<style lang="scss">
  button {
    justify-content: flex-start;
    width: auto;
  }

  .label {
    font-size: var(--font-title);
    font-weight: 600;
  }

  small {
    color: inherit;
    opacity: 0.72;
    font-size: var(--font-meta);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
