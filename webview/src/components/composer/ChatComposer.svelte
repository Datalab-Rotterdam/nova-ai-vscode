<script lang="ts">
  import plusLgIcon from 'bootstrap-icons/icons/plus-lg.svg?raw';
  import sendIcon from 'bootstrap-icons/icons/arrow-up.svg?raw';
  import slidersIcon from 'bootstrap-icons/icons/sliders.svg?raw';
  import type { ChatApprovalPolicy, ChatEnvironmentScope, ChatMode, CustomAgentDefinition, LanguageModelInfo } from '../../../../src/core/types';
  import IconButton from '../common/IconButton.svelte';
  import ApprovalMenu from './ApprovalMenu.svelte';
  import EnvironmentMenu from './EnvironmentMenu.svelte';
  import ModeMenu from './ModeMenu.svelte';
  import ModelMenu from './ModelMenu.svelte';

  export let value = '';
  export let disabled = false;
  export let editing = false;
  export let activeMode: ChatMode = 'agent';
  export let activeCustomAgentId: string | undefined = undefined;
  export let activeApprovalPolicy: ChatApprovalPolicy = 'safeOnly';
  export let activeEnvironmentScope: ChatEnvironmentScope = 'local';
  export let customAgents: CustomAgentDefinition[] = [];
  export let models: readonly LanguageModelInfo[] = [];
  export let selectedModelId = '';
  export let toolCount = 0;
  export let oninput: ((value: string) => void) | undefined;
  export let onsubmit: (() => void) | undefined;
  export let onselectMode: ((mode: ChatMode) => void) | undefined;
  export let onselectCustomAgent: ((id: string | undefined) => void) | undefined;
  export let onconfigureAgents: (() => void) | undefined;
  export let onopenModelPicker: (() => void) | undefined;
  export let onopenEnvironmentPicker: (() => void) | undefined;
  export let onopenApprovalPicker: (() => void) | undefined;

  const disabledTools = disabled || activeMode !== 'agent';

  function handleSubmit(event?: Event) {
    event?.preventDefault();
    if (!disabled && value.trim()) {
      onsubmit?.();
    }
  }
</script>

<form
  class="composer"
  onsubmit={handleSubmit}
>
  <textarea
    rows="2"
    placeholder={editing ? 'Edit the selected message' : 'Describe what to build'}
    {disabled}
    value={value}
    oninput={(event) => oninput?.((event.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>

  <div class="controls-row">
    <IconButton title="Add context" icon={plusLgIcon} disabled={true} />
    <ModeMenu
      {activeMode}
      {activeCustomAgentId}
      {customAgents}
      onselectMode={onselectMode}
      onselectCustomAgent={onselectCustomAgent}
      onconfigure={onconfigureAgents}
    />
    <ModelMenu
      models={models}
      {selectedModelId}
      onopen={onopenModelPicker}
    />
    <IconButton title="Composer settings" icon={slidersIcon} disabled={true} />
    <button class="send-button" type="submit" disabled={disabled || !value.trim()} aria-label={editing ? 'Resubmit message' : 'Send message'}>
      {@html sendIcon}
    </button>
  </div>

  <div class="footer-row">
    <EnvironmentMenu
      value={activeEnvironmentScope}
      disabled={disabledTools}
      onopen={onopenEnvironmentPicker}
    />
    <ApprovalMenu
      value={activeApprovalPolicy}
      onopen={onopenApprovalPicker}
    />
    <span class="tools-meta">{toolCount} tool{toolCount === 1 ? '' : 's'}</span>
  </div>
</form>

<style lang="scss">
  .composer {
    display: grid;
    gap: 0;
    border: 1px solid var(--divider);
    border-radius: var(--radius-xl);
    background: var(--panel-soft-bg);
    overflow: clip;
    box-shadow: var(--shadow-panel);
  }

  textarea,
  .controls-row {
    padding-inline: var(--space-5);
  }

  textarea {
    min-height: 48px;
    max-height: 92px;
    padding-block: var(--space-4) var(--space-2);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--fg);
    font-size: 12px;
    line-height: 1.35;
    resize: vertical;
  }

  textarea:focus {
    outline: none;
  }

  .controls-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 34px;
    padding-bottom: var(--space-3);
  }

  .send-button {
    margin-left: auto;
    width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--muted);
  }

  .send-button:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--fg);
  }

  .send-button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .send-button :global(svg) {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .footer-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 26px;
    padding: 0 var(--space-4) var(--space-3);
    color: var(--muted);
    font-size: 10px;
  }

  .tools-meta {
    margin-left: auto;
    white-space: nowrap;
  }

  @media (max-width: 860px) {
    textarea {
      min-height: 54px;
    }

    .footer-row {
      flex-wrap: wrap;
    }

    .controls-row {
      gap: var(--space-2);
    }

    .tools-meta {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
