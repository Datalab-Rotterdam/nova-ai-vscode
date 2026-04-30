<script lang="ts">
  export let narrow = false;
</script>

<section class={`shell ${narrow ? 'narrow' : ''}`}>
  <div class="sessions"><slot name="sessions" /></div>
  <div class="chat"><slot name="chat" /></div>
</section>

<style lang="scss">
  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: minmax(196px, 248px) minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--bg);
  }

  .sessions,
  .chat {
    min-width: 0;
  }

  .sessions {
    border-right: 1px solid var(--divider);
    padding-right: var(--space-4);
  }§

  .chat {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--space-4);
  }

  .narrow {
    grid-template-columns: 1fr;
  }

  .narrow .sessions {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
    padding-right: 0;
    padding-bottom: var(--space-4);
  }

  @media (max-width: 860px) {
    .shell {
      grid-template-columns: 1fr;
    }

    .sessions {
      border-right: 0;
      border-bottom: 1px solid var(--divider);
      padding-right: 0;
      padding-bottom: var(--space-4);
    }
  }
</style>
