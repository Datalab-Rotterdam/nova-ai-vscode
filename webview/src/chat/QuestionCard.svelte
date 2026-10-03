<script lang="ts">
    import {untrack} from 'svelte';
    import type {QuestionItem} from '../../../src/panel/protocol';

    let {item, post}: { item: QuestionItem; post: (message: Record<string, unknown>) => void } = $props();

    // The recommended option starts selected; the user still confirms.
    let selected = $state<string[]>(untrack(() => item.options.filter((option) => option.recommended).map((option) => option.label)));
    let other = $state('');

    const answer = $derived([...selected, ...(other.trim() ? [other.trim()] : [])].join(', '));

    function toggle(label: string) {
        if (item.multiSelect) {
            selected = selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label];
        } else {
            selected = [label];
            other = '';
        }
    }

    function submit(event: SubmitEvent) {
        event.preventDefault();
        if (answer) {
            post({command: 'chat/answer', itemId: item.id, answer});
        }
    }
</script>

<form class={`question ${item.status}`} onsubmit={submit}>
    <p class="prompt">
        <span class="codicon codicon-question" aria-hidden="true"></span>{item.question}
    </p>

    {#if item.status === 'pending'}
        {#if item.options.length}
            <div class="options" role={item.multiSelect ? 'group' : 'radiogroup'}>
                {#each item.options as option (option.label)}
                    <button
                            type="button"
                            class="option"
                            class:selected={selected.includes(option.label)}
                            role={item.multiSelect ? 'checkbox' : 'radio'}
                            aria-checked={selected.includes(option.label)}
                            onclick={() => toggle(option.label)}
                    >
                        <span class={`codicon codicon-${item.multiSelect
                            ? (selected.includes(option.label) ? 'pass-filled' : 'circle-large-outline')
                            : (selected.includes(option.label) ? 'circle-large-filled' : 'circle-large-outline')}`} aria-hidden="true"></span>
                        <span class="option-copy">
                            <span class="label">
                                {option.label}
                                {#if option.recommended}<span class="badge">Recommended</span>{/if}
                            </span>
                            {#if option.description}<span class="description">{option.description}</span>{/if}
                        </span>
                    </button>
                {/each}
            </div>
        {/if}

        {#if item.allowOther}
            <input
                    class="nova-input"
                    bind:value={other}
                    oninput={() => { if (!item.multiSelect && other.trim()) selected = []; }}
                    placeholder={item.options.length ? 'Or type your own answer…' : 'Type your answer…'}
                    aria-label="Your own answer"
            />
        {/if}

        <div class="actions">
            <button class="nova-button" type="submit" disabled={!answer}>Answer</button>
            <button class="nova-button secondary" type="button" onclick={() => post({command: 'chat/skipQuestion', itemId: item.id})} title="Let Nova decide">Skip</button>
        </div>
    {:else if item.status === 'answered'}
        <p class="result"><span class="codicon codicon-check" aria-hidden="true"></span>{item.answer}</p>
    {:else}
        <p class="result skipped">Skipped — Nova decides.</p>
    {/if}
</form>

<style lang="scss">
  .question {
    display: grid;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--nova-brand-primary) 45%, var(--nova-subtle-border));
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);

    &.answered,
    &.skipped {
      border-color: var(--nova-subtle-border);
    }
  }

  p {
    margin: 0;
  }

  .prompt {
    display: flex;
    gap: 6px;
    font-weight: 600;

    .codicon {
      flex: none;
      margin-top: 2px;
      color: var(--nova-brand-primary);
    }
  }

  .options {
    display: grid;
    gap: 4px;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    > .codicon {
      flex: none;
      margin-top: 2px;
      color: var(--nova-muted);
    }

    &:hover {
      background: var(--nova-hover);
    }

    &.selected {
      border-color: var(--nova-focus);
      background: color-mix(in srgb, var(--nova-focus) 10%, transparent);

      > .codicon {
        color: var(--nova-focus);
      }
    }
  }

  .option-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .badge {
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nova-brand-primary) 22%, transparent);
    color: var(--nova-fg);
    font-size: 0.8em;
    line-height: 16px;
  }

  .description {
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .actions {
    display: flex;
    gap: 6px;

    .nova-button {
      width: auto;
      padding: 2px 12px;
    }
  }

  .result {
    display: flex;
    gap: 6px;
    color: var(--nova-fg);

    .codicon {
      color: var(--nova-success);
    }

    &.skipped {
      color: var(--nova-muted);
    }
  }
</style>
