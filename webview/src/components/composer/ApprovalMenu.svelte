<script lang="ts">
  import caretDownIcon from 'bootstrap-icons/icons/chevron-down.svg?raw';
  import shieldCheckIcon from 'bootstrap-icons/icons/shield-check.svg?raw';
  import PillButton from '../common/PillButton.svelte';
  import type { ChatApprovalPolicy } from '../../../../src/core/types';

  export let value: ChatApprovalPolicy = 'safeOnly';
  export let onopen: (() => void) | undefined;

  const labelFor = (policy: ChatApprovalPolicy) =>
    policy === 'always'
      ? 'Always Confirm'
      : policy === 'neverForSafe'
        ? 'Allow All Tools'
        : 'Default Approvals';
</script>

<div class="approval-button">
  <PillButton
    label={labelFor(value)}
    icon={`${shieldCheckIcon}${caretDownIcon}`}
    compact={true}
    onclick={() => onopen?.()}
  />
</div>

<style lang="scss">
  .approval-button :global(.ui-pill-button > span[aria-hidden='true']) {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
