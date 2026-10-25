<script lang="ts">
    import type {SettingRow, SettingsPageData, SettingsSection} from '../../../src/settings/protocol';
    import {renderMarkdown} from '../chat/markdown';

    let {data, post}: { data: SettingsPageData | undefined; post: (message: Record<string, unknown>) => void } = $props();

    let query = $state('');
    let main: HTMLElement | undefined = $state();

    const matches = (row: SettingRow, words: string[]) => {
        const text = `${row.label} ${row.key} ${row.description}`.toLowerCase();
        return words.every((word) => text.includes(word));
    };
    const sections = $derived.by((): SettingsSection[] => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (data?.sections ?? [])
            .map((section) => ({...section, rows: words.length ? section.rows.filter((row) => matches(row, words)) : section.rows}))
            .filter((section) => section.rows.length);
    });
    /** "Chat › Sub-agents" under "Chat": the table of contents nests by the section titles. */
    const toc = $derived.by(() => {
        const groups: Array<{ title: string; id: string; children: Array<{ title: string; id: string }> }> = [];
        for (const section of sections) {
            const [group, child] = section.title.split(' › ');
            let entry = groups.find((candidate) => candidate.title === group);
            if (!entry) {
                entry = {title: group, id: section.id, children: []};
                groups.push(entry);
            }
            if (child) {
                entry.children.push({title: child, id: section.id});
            }
        }
        return groups;
    });

    function jump(id: string) {
        main?.querySelector(`#section-${CSS.escape(id)}`)?.scrollIntoView({block: 'start'});
    }

    function set(row: SettingRow, value: unknown) {
        post({command: 'settings/set', key: row.key, value});
    }

    function setNumber(row: SettingRow, input: HTMLInputElement) {
        const value = Number(input.value);
        const valid = input.value.trim() !== '' && Number.isFinite(value) && (!row.integer || Number.isInteger(value))
            && (row.min === undefined || value >= row.min) && (row.max === undefined || value <= row.max);
        input.setCustomValidity(valid ? '' : `Enter ${row.integer ? 'a whole number' : 'a number'}${row.min !== undefined ? ` from ${row.min}` : ''}${row.max !== undefined ? ` to ${row.max}` : ''}.`);
        input.reportValidity();
        if (valid && value !== row.value) {
            set(row, value);
        }
    }

    function toggle(row: SettingRow, value: string, on: boolean) {
        const current = Array.isArray(row.value) ? row.value as string[] : [];
        set(row, on ? [...current, value] : current.filter((item) => item !== value));
    }

    /** The value as text for the selected option of a list (a model id, an enum value). */
    const selected = (row: SettingRow) => String(row.value ?? '');
</script>

<div class="page">
    <header>
        <h1>Nova Settings</h1>
        <div class="search">
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input bind:value={query} type="text" placeholder="Search settings" aria-label="Search settings"/>
            {#if query}
                <button class="clear codicon codicon-close" title="Clear search" aria-label="Clear search" onclick={() => query = ''}></button>
            {/if}
        </div>
        <div class="bar">
            <div class="tabs" role="tablist" aria-label="Where to save">
                <button role="tab" class:active={data?.scope === 'user'} aria-selected={data?.scope === 'user'} title="Settings for you, in every project"
                        onclick={() => post({command: 'settings/scope', scope: 'user'})}>User</button>
                <button role="tab" class:active={data?.scope === 'workspace'} aria-selected={data?.scope === 'workspace'} disabled={!data?.hasWorkspace}
                        title={data?.hasWorkspace ? 'Settings for this workspace only; they win over your user settings' : 'Open a folder for workspace settings'}
                        onclick={() => post({command: 'settings/scope', scope: 'workspace'})}>Workspace</button>
            </div>
            <span class="spacer"></span>
            <button class="link" onclick={() => post({command: 'settings/openJson'})}>
                <span class="codicon codicon-json" aria-hidden="true"></span> Open settings.json
            </button>
            <button class="link" onclick={() => post({command: 'settings/openVsCode'})}>
                <span class="codicon codicon-settings" aria-hidden="true"></span> VS Code settings
            </button>
        </div>
    </header>

    {#if !data}
        <div class="nova-loader" aria-label="Loading settings"></div>
    {:else}
        <div class="body">
            <nav aria-label="Sections">
                {#each toc as group (group.title)}
                    <button class="toc" onclick={() => jump(group.id)}>{group.title}</button>
                    {#each group.children as child (child.id)}
                        <button class="toc child" onclick={() => jump(child.id)}>{child.title}</button>
                    {/each}
                {/each}
            </nav>
            <main bind:this={main}>
                {#if !sections.length}
                    <p class="empty">No settings match "{query}".</p>
                {/if}
                {#each sections as section (section.id)}
                    <section id={`section-${section.id}`}>
                        <h2>{section.title}</h2>
                        {#each section.rows as row (row.key)}
                            <div class="row" class:modified={row.setHere}>
                                <div class="head">
                                    <span class="label">{row.label}</span>
                                    {#if row.setHere}<span class="tag">Modified</span>{/if}
                                    {#if row.overridden}<span class="tag warn" title="This workspace sets its own value, which is used here">Workspace overrides this</span>{/if}
                                    {#if row.userOnly && data.scope === 'workspace'}<span class="tag">User setting only</span>{/if}
                                    {#if row.setHere}
                                        <button class="reset" title="Back to the default ({JSON.stringify(row.defaultValue)})" onclick={() => post({command: 'settings/reset', key: row.key})}>Reset</button>
                                    {/if}
                                    <code class="key">{row.key}</code>
                                </div>

                                {#if row.control === 'boolean'}
                                    <label class="check">
                                        <input type="checkbox" checked={row.value === true} disabled={row.userOnly && data.scope === 'workspace'} onchange={(event) => set(row, event.currentTarget.checked)}/>
                                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                        <span class="description">{@html renderMarkdown(row.description)}</span>
                                    </label>
                                {:else}
                                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                    <div class="description">{@html renderMarkdown(row.description)}</div>
                                    {#if row.control === 'number'}
                                        <input class="input number" type="number" value={row.value} min={row.min} max={row.max} step={row.integer ? 1 : 'any'}
                                               disabled={row.userOnly && data.scope === 'workspace'} onchange={(event) => setNumber(row, event.currentTarget)}/>
                                    {:else if row.control === 'text'}
                                        <input class="input" type="text" value={row.value ?? ''} disabled={row.userOnly && data.scope === 'workspace'}
                                               onchange={(event) => set(row, event.currentTarget.value)}/>
                                    {:else if row.control === 'enum' || row.control === 'model'}
                                        <select class="input" value={selected(row)} disabled={row.userOnly && data.scope === 'workspace'} onchange={(event) => set(row, event.currentTarget.value)}>
                                            {#if row.control === 'model' && selected(row) && !row.options?.some((option) => option.value === selected(row))}
                                                <option value={selected(row)}>{selected(row)} (not available)</option>
                                            {/if}
                                            {#each row.options ?? [] as option (option.value)}
                                                <option value={option.value}>{option.label}{option.description ? ` (${option.description})` : ''}</option>
                                            {/each}
                                        </select>
                                        {#if row.control === 'model' && (row.options?.length ?? 0) <= 1}
                                            <p class="hint">No models to choose from yet: connect Nova AI{row.key === 'nova.index.model' ? ', or your gateway lists no embedding models' : ''}.</p>
                                        {/if}
                                    {:else if row.control === 'multi'}
                                        <div class="multi">
                                            {#each row.options ?? [] as option (option.value)}
                                                <label class="check">
                                                    <input type="checkbox" checked={Array.isArray(row.value) && row.value.includes(option.value)}
                                                           onchange={(event) => toggle(row, option.value, event.currentTarget.checked)}/>
                                                    <span>{option.label}{#if option.description}<span class="muted"> {option.description}</span>{/if}</span>
                                                </label>
                                            {:else}
                                                <p class="hint">No models to choose from yet: connect Nova AI.</p>
                                            {/each}
                                        </div>
                                    {:else}
                                        <button class="link" onclick={() => post({command: 'settings/openJson'})}>Edit in settings.json</button>
                                    {/if}
                                {/if}
                            </div>
                        {/each}
                    </section>
                {/each}
            </main>
        </div>
    {/if}
</div>

<style lang="scss">
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: clip;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  header {
    flex: none;
    padding: 16px 24px 0;
    border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
  }

  h1 {
    margin: 0 0 10px;
    font-size: 1.4em;
    font-weight: 600;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 900px;
    padding: 0 8px;
    border: 1px solid var(--vscode-settings-textInputBorder, var(--nova-input-border));
    border-radius: 2px;
    background: var(--vscode-settings-textInputBackground, var(--nova-input-bg));
    color: var(--vscode-settings-textInputForeground, var(--nova-input-fg));

    &:focus-within {
      border-color: var(--nova-focus);
    }

    input {
      flex: 1;
      min-width: 0;
      padding: 7px 0;
      border: 0;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;
    }
  }

  .clear {
    border: 0;
    background: none;
    color: var(--nova-muted);
    cursor: pointer;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .tabs {
    display: flex;

    button {
      padding: 6px 10px;
      border: 0;
      border-bottom: 1px solid transparent;
      background: none;
      color: var(--nova-muted);
      font: inherit;
      text-transform: uppercase;
      font-size: 0.85em;
      cursor: pointer;

      &.active {
        border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--nova-focus));
        color: var(--vscode-panelTitle-activeForeground, var(--nova-fg));
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  .spacer {
    flex: 1;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: 0;
    background: none;
    color: var(--vscode-textLink-foreground);
    font: inherit;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  nav {
    flex: none;
    width: 190px;
    padding: 12px 0 12px 16px;
    overflow-y: auto;

    @media (max-width: 640px) {
      display: none;
    }
  }

  .toc {
    display: block;
    width: 100%;
    padding: 3px 8px;
    border: 0;
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &.child {
      padding-left: 22px;
      color: var(--nova-muted);
    }

    &:hover {
      background: var(--vscode-list-hoverBackground, var(--nova-hover));
    }
  }

  main {
    flex: 1;
    min-width: 0;
    padding: 4px 24px 40px;
    overflow-y: auto;
  }

  h2 {
    margin: 20px 0 6px;
    font-size: 1.15em;
    font-weight: 600;
  }

  .row {
    max-width: 900px;
    padding: 10px 12px 12px;
    border-left: 2px solid transparent;

    &.modified {
      border-left-color: var(--vscode-settings-modifiedItemIndicator, var(--nova-focus));
    }

    &:hover {
      background: var(--vscode-settings-rowHoverBackground, color-mix(in srgb, var(--nova-fg) 3%, transparent));
    }
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }

  .label {
    font-weight: 600;
  }

  .key {
    margin-left: auto;
    color: var(--nova-muted);
    font-size: 0.85em;
    opacity: 0;
  }

  .row:hover .key {
    opacity: 1;
  }

  .tag {
    padding: 0 5px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 999px;
    color: var(--nova-muted);
    font-size: 0.8em;

    &.warn {
      border-color: var(--nova-warning);
    }
  }

  .reset {
    padding: 0;
    border: 0;
    background: none;
    color: var(--vscode-textLink-foreground);
    font-size: 0.85em;
    cursor: pointer;
  }

  .description {
    color: var(--vscode-descriptionForeground, var(--nova-muted));

    :global(p) {
      margin: 0 0 6px;
    }

    :global(code) {
      font-family: var(--nova-mono);
      font-size: 0.92em;
    }
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;

    input {
      margin: 2px 0 0;
    }
  }

  .input {
    width: min(420px, 100%);
    margin-top: 4px;
    padding: 4px 6px;
    border: 1px solid var(--vscode-settings-textInputBorder, var(--vscode-settings-dropdownBorder, var(--nova-input-border)));
    border-radius: 2px;
    background: var(--vscode-settings-textInputBackground, var(--vscode-settings-dropdownBackground, var(--nova-input-bg)));
    color: var(--vscode-settings-textInputForeground, var(--nova-input-fg));
    font: inherit;

    &.number {
      width: 140px;
    }

    &:invalid {
      border-color: var(--vscode-inputValidation-errorBorder, var(--nova-error));
    }
  }

  select.input {
    background: var(--vscode-settings-dropdownBackground, var(--nova-input-bg));
    color: var(--vscode-settings-dropdownForeground, var(--nova-input-fg));
  }

  .multi {
    display: grid;
    gap: 4px;
    margin-top: 4px;
  }

  .muted,
  .hint,
  .empty {
    color: var(--nova-muted);
  }

  .hint {
    margin: 4px 0 0;
    font-size: 0.9em;
  }
</style>
