<script lang="ts">
  import bracesIcon from 'bootstrap-icons/icons/braces.svg?raw';
  import caretDownIcon from 'bootstrap-icons/icons/chevron-down.svg?raw';
  import listCheckIcon from 'bootstrap-icons/icons/list-check.svg?raw';
  import patchQuestionIcon from 'bootstrap-icons/icons/patch-question.svg?raw';
  import Menu from '../common/Menu.svelte';
  import PillButton from '../common/PillButton.svelte';
  import type { ChatMode, CustomAgentDefinition } from '../../../../src/core/types';

  export let activeMode: ChatMode = 'agent';
  export let activeCustomAgentId: string | undefined = undefined;
  export let customAgents: CustomAgentDefinition[] = [];
  export let onselectMode: ((mode: ChatMode) => void) | undefined;
  export let onselectCustomAgent: ((id: string | undefined) => void) | undefined;
  export let onconfigure: (() => void) | undefined;

  let open = false;

  const iconFor = (mode: ChatMode) => mode === 'agent' ? bracesIcon : mode === 'plan' ? listCheckIcon : patchQuestionIcon;
  $: label = activeCustomAgentId
    ? (customAgents.find((item) => item.id === activeCustomAgentId)?.label ?? 'Agent')
    : activeMode === 'agent' ? 'Agent' : activeMode === 'ask' ? 'Ask' : 'Plan';
</script>

<div class="root">
  <PillButton
    label={label}
    secondaryLabel=""
    icon={`${iconFor(activeMode)}${caretDownIcon}`}
    compact={true}
    onclick={() => open = !open}
  />

  <Menu {open} width={290}>
    <button class={`ui-menu-item ${!activeCustomAgentId && activeMode === 'agent' ? 'selected' : ''}`} onclick={() => { onselectCustomAgent?.(undefined); onselectMode?.('agent'); open = false; }}>
      <span>Agent</span>
    </button>
    <button class={`ui-menu-item ${!activeCustomAgentId && activeMode === 'ask' ? 'selected' : ''}`} onclick={() => { onselectCustomAgent?.(undefined); onselectMode?.('ask'); open = false; }}>
      <span>Ask</span>
    </button>
    <button class={`ui-menu-item ${!activeCustomAgentId && activeMode === 'plan' ? 'selected' : ''}`} onclick={() => { onselectCustomAgent?.(undefined); onselectMode?.('plan'); open = false; }}>
      <span>Plan</span>
    </button>
    {#if customAgents.length}
      <div class="ui-menu-divider"></div>
      {#each customAgents as agent}
        <button class={`ui-menu-item ${activeCustomAgentId === agent.id ? 'selected' : ''}`} onclick={() => { onselectCustomAgent?.(agent.id); open = false; }}>
          <span>{agent.label}</span>
          <small>{agent.description ?? agent.mode ?? 'custom agent'}</small>
        </button>
      {/each}
    {/if}
    <div class="ui-menu-divider"></div>
    <button class="ui-menu-item" onclick={() => { onconfigure?.(); open = false; }}>
      <span>Configure Custom Agents...</span>
    </button>
  </Menu>
</div>

<style lang="scss">
  .root {
    position: relative;
  }

  :global(.root .ui-pill-button > span[aria-hidden='true']) {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
