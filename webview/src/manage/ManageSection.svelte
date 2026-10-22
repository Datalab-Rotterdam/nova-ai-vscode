<script lang="ts">
    import type {Snippet} from 'svelte';

    let {title, hint, count, children}: { title: string; hint?: string; count?: number; children: Snippet } = $props();
</script>

<section>
    <h2>{title}{#if count !== undefined}<span class="count">{count}</span>{/if}</h2>
    {#if hint}<p class="hint">{hint}</p>{/if}
    <div class="items">
        {@render children()}
    </div>
</section>

<style lang="scss">
  section {
    margin-bottom: 24px;
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 16px 0 2px;
    font-size: 1.15em;
    font-weight: 600;
  }

  .count {
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 400;
  }

  .hint {
    margin: 0 0 8px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .items {
    display: grid;
    gap: 6px;
    margin-top: 8px;
  }
</style>
