<script lang="ts">
  import caretDownIcon from 'bootstrap-icons/icons/chevron-down.svg?raw';
  import PillButton from '../common/PillButton.svelte';
  import type { LanguageModelInfo } from '../../../../src/core/types';

  export let models: readonly LanguageModelInfo[] = [];
  export let selectedModelId = '';
  export let onopen: (() => void) | undefined;

  $: selected = models.find((item) => item.id === selectedModelId) ?? models[0];
</script>

<PillButton
  label={selected?.name ?? 'Model'}
  icon={caretDownIcon}
  compact={true}
  onclick={() => onopen?.()}
/>
