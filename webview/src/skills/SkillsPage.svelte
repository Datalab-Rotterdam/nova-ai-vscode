<script lang="ts">
    import {onMount, untrack} from 'svelte';
    import type {SkillFolderName, SkillRow, SkillScopeName, SkillsPageData} from '../../../src/skills/protocol';

    let {data, post, initialScope = 'global', onScope}: {
        data: SkillsPageData | undefined;
        post: (message: Record<string, unknown>) => void;
        /** The tab shown first (kept across reloads by the caller). */
        initialScope?: SkillScopeName;
        onScope?: (scope: SkillScopeName) => void;
    } = $props();

    let scope = $state<SkillScopeName>(untrack(() => initialScope));
    let query = $state('');
    let search: HTMLInputElement | undefined = $state();

    const FOLDERS: Array<{ folder: SkillFolderName; label: string }> = [
        {folder: 'nova', label: 'Nova'},
        {folder: '.agents', label: '.agents'},
        {folder: '.claude', label: '.claude'},
        {folder: '.codex', label: '.codex'}
    ];

    type Section = { id: string; title: string; hint?: string; rows: SkillRow[]; kind: 'own' | 'global-in-project' };

    const matches = (row: SkillRow) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const text = `${row.name} ${row.description} ${row.location}`.toLowerCase();
        return words.every((word) => text.includes(word));
    };

    const sections = $derived.by((): Section[] => {
        if (!data) {
            return [];
        }
        const own = data.skills.filter((row) => row.scope === scope && matches(row));
        const result: Section[] = FOLDERS.map(({folder, label}) => ({
            id: `${scope}-${folder}`,
            title: folder === 'nova' ? 'Nova skills' : `${label} skills`,
            hint: folder === 'nova'
                ? (scope === 'global' ? data!.folders.global : data!.folders.project)
                : `${scope === 'global' ? '~/' : ''}${label}/skills, shared with other tools`,
            rows: own.filter((row) => row.folder === folder),
            kind: 'own' as const
        })).filter((section) => section.rows.length || (section.id.endsWith('-nova') && !query));
        if (scope === 'project') {
            // The global skills this project sees, to switch off here only.
            const globalRows = data.skills.filter((row) => row.scope === 'global' && !row.replacedBy && matches(row));
            if (globalRows.length) {
                result.push({
                    id: 'project-global',
                    title: 'Global skills in this project',
                    hint: 'Switching one off here keeps it for other projects.',
                    rows: globalRows,
                    kind: 'global-in-project'
                });
            }
        }
        return result;
    });

    const shown = $derived(sections.reduce((total, section) => total + section.rows.length, 0));

    onMount(() => {
        search?.focus();
    });

    function setScope(next: SkillScopeName) {
        scope = next;
        onScope?.(next);
    }

    function onKey(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            search?.focus();
            search?.select();
        } else if (event.key === 'Escape' && document.activeElement === search && query) {
            query = '';
        }
    }

    function folderLabel(row: SkillRow): string {
        return FOLDERS.find((entry) => entry.folder === row.folder)?.label ?? row.folder;
    }

    /** The checkbox of a row: which setting it changes and whether it can. */
    function toggle(row: SkillRow, kind: Section['kind']): { checked: boolean; disabled: boolean; label: string; note?: string; target: SkillScopeName } {
        if (row.replacedBy) {
            return {checked: false, disabled: true, label: 'Not used', note: `${row.replacedBy} has the same name and is used instead.`, target: scope};
        }
        if (kind === 'global-in-project') {
            return row.offGlobally
                ? {checked: false, disabled: true, label: 'Use in this project', note: 'Switched off for every project (Global tab).', target: 'project'}
                : {checked: !row.offInProject, disabled: false, label: 'Use in this project', target: 'project'};
        }
        if (row.scope === 'global') {
            return {
                checked: !row.offGlobally,
                disabled: false,
                label: 'Use in every project',
                note: !row.offGlobally && row.offInProject ? 'Switched off in this project (Project tab).' : undefined,
                target: 'global'
            };
        }
        return row.offGlobally
            ? {checked: false, disabled: true, label: 'Use in this project', note: 'A skill with this name is switched off for every project (Global tab).', target: 'project'}
            : {checked: !row.offInProject, disabled: false, label: 'Use in this project', target: 'project'};
    }

    function jump(id: string) {
        document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
</script>

<svelte:window onkeydown={onKey}/>

<div class="skills">
    <header>
        <div class="search">
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input bind:this={search} bind:value={query} type="text" placeholder="Search skills" aria-label="Search skills"/>
            {#if query}
                <span class="count">{shown} {shown === 1 ? 'skill' : 'skills'} found</span>
                <button class="icon codicon codicon-close" title="Clear search" aria-label="Clear search" onclick={() => { query = ''; search?.focus(); }}></button>
            {/if}
        </div>
        <div class="bar">
            <div class="tabs" role="tablist" aria-label="Scope">
                <button role="tab" class:active={scope === 'global'} aria-selected={scope === 'global'} onclick={() => setScope('global')}>Global</button>
                <button role="tab" class:active={scope === 'project'} aria-selected={scope === 'project'} disabled={!data?.hasProject} title={data?.hasProject ? undefined : 'Open a folder to use project skills'} onclick={() => setScope('project')}>Project</button>
            </div>
            {#if data}
                <span class="usage" title="Only names and short descriptions are in every request; Nova reads a skill's instructions when it uses it.">
                    {data.enabledCount} in use · about {data.promptTokens.toLocaleString()} tokens per request
                </span>
            {/if}
            <span class="spacer"></span>
            <button class="secondary" onclick={() => post({command: 'skills/openFolder', scope})} disabled={scope === 'project' && !data?.hasProject}>
                <span class="codicon codicon-folder-opened" aria-hidden="true"></span> Open Folder
            </button>
            <button class="primary" onclick={() => post({command: 'skills/create', scope})} disabled={scope === 'project' && !data?.hasProject}>
                <span class="codicon codicon-add" aria-hidden="true"></span> New Skill
            </button>
        </div>
    </header>

    {#if !data}
        <div class="nova-loader" aria-label="Loading skills"></div>
    {:else}
        <div class="body">
            <nav class="toc" aria-label="Sections">
                {#each sections as section (section.id)}
                    <button onclick={() => jump(section.id)}>{section.title} <span class="toc-count">{section.rows.length}</span></button>
                {/each}
            </nav>

            <main>
                {#each sections as section (section.id)}
                    <section id={section.id}>
                        <h2>{section.title}</h2>
                        {#if section.hint}<p class="hint">{section.hint}</p>{/if}

                        {#if !section.rows.length}
                            <div class="empty">
                                <p>
                                    {scope === 'global'
                                        ? 'No global skills yet. They are available in every project.'
                                        : 'No project skills yet. They live in the repository, so your team gets them too.'}
                                </p>
                                <button class="primary" onclick={() => post({command: 'skills/create', scope})}>
                                    <span class="codicon codicon-add" aria-hidden="true"></span> New Skill
                                </button>
                            </div>
                        {/if}

                        {#each section.rows as row (row.path + section.kind)}
                            {@const state = toggle(row, section.kind)}
                            <article class="item" class:off={!state.checked} class:replaced={Boolean(row.replacedBy)}>
                                <div class="item-title">
                                    <span class="category">{folderLabel(row)}:</span>
                                    <strong>{row.name}</strong>
                                    {#if row.enabled}<span class="badge">in use</span>{/if}
                                </div>
                                <p class="item-description">{row.description}</p>
                                <label class="check">
                                    <input
                                        type="checkbox"
                                        checked={state.checked}
                                        disabled={state.disabled}
                                        onchange={(event) => post({command: 'skills/toggle', name: row.name, scope: state.target, enabled: (event.currentTarget as HTMLInputElement).checked})}
                                    />
                                    <span>{state.label}</span>
                                </label>
                                {#if state.note}<p class="note">{state.note}</p>{/if}
                                {#if section.kind === 'own'}
                                    <div class="actions">
                                        <span class="location" title={row.path}>{row.location}</span>
                                        <button class="link" onclick={() => post({command: 'skills/open', path: row.path})}>Edit</button>
                                        <button class="link" onclick={() => post({command: 'skills/reveal', path: row.path})}>Reveal</button>
                                        {#if row.scope === 'project' || data.hasProject}
                                            <button class="link" onclick={() => post({command: 'skills/move', path: row.path, to: row.scope === 'global' ? 'project' : 'global'})}>
                                                Move to {row.scope === 'global' ? 'Project' : 'Global'}
                                            </button>
                                        {/if}
                                        <button class="link danger" onclick={() => post({command: 'skills/delete', path: row.path})}>Delete</button>
                                    </div>
                                {/if}
                            </article>
                        {/each}
                    </section>
                {/each}
                {#if query && !shown}
                    <p class="empty">No skills match “{query}”.</p>
                {/if}
            </main>
        </div>
    {/if}
</div>

<style lang="scss">
  .skills {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  header {
    flex: none;
    padding: 12px 24px 0;
    border-bottom: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
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
      padding: 8px 0;
      border: 0;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;
      font-size: 1.05em;

      &::placeholder {
        color: var(--nova-input-placeholder);
      }
    }

    .count {
      color: var(--nova-muted);
      font-size: 0.9em;
      white-space: nowrap;
    }
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 10px;
  }

  .tabs {
    display: flex;
    gap: 4px;

    button {
      padding: 4px 10px 6px;
      border: 0;
      border-bottom: 1px solid transparent;
      background: none;
      color: var(--vscode-panelTitle-inactiveForeground, var(--nova-muted));
      font: inherit;
      font-weight: 600;
      cursor: pointer;

      &.active {
        border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--nova-focus));
        color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  .usage {
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .spacer {
    flex: 1;
  }

  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--nova-button-border);
    border-radius: 2px;
    font: inherit;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  .primary {
    background: var(--nova-button-bg);
    color: var(--nova-button-fg);

    &:hover:not(:disabled) {
      background: var(--nova-button-hover);
    }
  }

  .secondary {
    background: var(--nova-secondary-bg);
    color: var(--nova-secondary-fg);

    &:hover:not(:disabled) {
      background: var(--nova-secondary-hover);
    }
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .toc {
    flex: none;
    width: 200px;
    padding: 12px 0 12px 16px;
    overflow-y: auto;

    button {
      display: flex;
      justify-content: space-between;
      width: 100%;
      padding: 3px 8px;
      border: 0;
      background: none;
      color: var(--vscode-foreground);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover {
        background: var(--vscode-list-hoverBackground);
      }
    }

    .toc-count {
      color: var(--nova-muted);
    }
  }

  @media (max-width: 640px) {
    .toc {
      display: none;
    }
  }

  main {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: 8px 24px 32px 16px;
  }

  section {
    margin-bottom: 20px;
  }

  h2 {
    margin: 12px 0 2px;
    color: var(--vscode-settings-headerForeground, var(--vscode-foreground));
    font-size: 1.6em;
    font-weight: 600;
  }

  .hint {
    margin: 0 0 8px;
    color: var(--nova-muted);
  }

  .item {
    max-width: 900px;
    margin: 0 0 4px -10px;
    padding: 10px 10px 12px 8px;
    border-left: 2px solid transparent;

    &:hover,
    &:focus-within {
      border-left-color: var(--vscode-settings-modifiedItemIndicator, var(--nova-focus));
      background: var(--vscode-settings-rowHoverBackground, transparent);
    }

    &.replaced {
      opacity: 0.65;
    }
  }

  .item-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 4px;

    .category {
      color: var(--vscode-foreground);
    }

    strong {
      font-weight: 600;
    }
  }

  .badge {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 0.8em;
  }

  .item-description {
    margin: 0 0 8px;
    color: var(--vscode-descriptionForeground);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;

    input {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--vscode-settings-checkboxBackground, var(--nova-button-bg));
    }
  }

  .note {
    margin: 6px 0 0;
    color: var(--nova-warning);
    font-size: 0.9em;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    margin-top: 8px;
    font-size: 0.9em;

    .location {
      color: var(--nova-muted);
      font-family: var(--nova-mono);
    }
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-link);
    font: inherit;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }

    &.danger {
      color: var(--nova-error);
    }
  }

  .empty {
    display: grid;
    justify-items: start;
    gap: 8px;
    color: var(--nova-muted);

    p {
      margin: 0;
    }
  }
</style>
