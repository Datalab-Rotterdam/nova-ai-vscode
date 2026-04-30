<script lang="ts">
  export let open = false;
  export let width = 260;
  export let align: 'left' | 'right' = 'left';
</script>

{#if open}
  <div class={`ui-menu-surface ${align}`} style={`width:${width}px`}>
    <slot />
  </div>
{/if}

<style lang="scss">
  div {
    top: calc(100% + var(--space-2));
  }

  .left {
    left: 0;
  }

  .right {
    right: 0;
  }
</style>
