<script lang="ts">
  import caretDownIcon from 'bootstrap-icons/icons/chevron-down.svg?raw';
  import displayIcon from 'bootstrap-icons/icons/display.svg?raw';
  import PillButton from '../common/PillButton.svelte';
  import type { ChatEnvironmentScope } from '../../../../src/core/types';

  export let value: ChatEnvironmentScope = 'local';
  export let disabled = false;
  export let onopen: (() => void) | undefined;

  $: label = value === 'local' ? 'Local' : 'Chat Only';
</script>

<div class="environment-button">
  <PillButton
    label={label}
    icon={`${displayIcon}${caretDownIcon}`}
    compact={true}
    {disabled}
    onclick={() => {
      if (!disabled) {
        onopen?.();
      }
    }}
  />
</div>

<style lang="scss">
  .environment-button :global(.ui-pill-button > span[aria-hidden='true']) {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
