<script lang="ts">
  export let label = '';
  export let count: string | number | undefined = undefined;
</script>

<div class="ui-section-header">
  <span>{label}</span>
  {#if count !== undefined}
    <span>{count}</span>
  {/if}
</div>
