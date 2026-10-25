<script lang="ts">
    /** An on/off switch: a track with a sliding thumb. */
    let {checked, label, disabled = false, onchange}: {checked: boolean; label: string; disabled?: boolean; onchange: (checked: boolean) => void} = $props();
</script>

<input type="checkbox" role="switch" class="toggle" {checked} {disabled} aria-label={label} title={label} onchange={(event) => onchange(event.currentTarget.checked)}/>

<style lang="scss">
  .toggle {
    appearance: none;
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    margin: 0;
    border-radius: 999px;
    background: var(--nova-hover);
    cursor: pointer;
    transition: background 0.12s ease;

    &::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--vscode-foreground);
      transition: transform 0.12s ease;
    }

    &:checked {
      background: var(--nova-focus);

      &::after {
        transform: translateX(14px);
        background: var(--vscode-button-foreground, #fff);
      }
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
</style>
