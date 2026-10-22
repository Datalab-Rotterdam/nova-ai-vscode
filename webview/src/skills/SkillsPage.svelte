<script lang="ts">
    import {untrack} from 'svelte';
    import type {SkillFolderName, SkillRow, SkillScopeName, SkillsPageData} from '../../../src/skills/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';

    let {data, post, initialScope = 'global', onScope}: {
        data: SkillsPageData | undefined;
        post: (message: Record<string, unknown>) => void;
        /** The tab shown first (kept across reloads by the caller). */
        initialScope?: SkillScopeName;
        onScope?: (scope: SkillScopeName) => void;
    } = $props();

    let scope = $state<SkillScopeName>(untrack(() => initialScope));
    let query = $state('');

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

    const noProject = $derived(scope === 'project' && !data?.hasProject);
</script>

<ManagePage
    noun="skills"
    bind:query
    found={shown}
    tabs={[
        {id: 'global', label: 'Global'},
        {id: 'project', label: 'Project'}
    ]}
    {scope}
    onScope={(id) => { scope = id as SkillScopeName; onScope?.(scope); }}
    onCreate={() => post({command: 'skills/create', scope})}
    createLabel="New Skill"
    canCreate={!noProject}
    onOpenFolder={() => post({command: 'skills/openFolder', scope})}
>
    {#snippet summary()}
        {#if data}
            <span title="Only names and short descriptions are in every request; Nova reads a skill's instructions when it uses it.">
                {data.enabledCount} in use · about {data.promptTokens.toLocaleString()} tokens per request
            </span>
        {/if}
    {/snippet}

    {#if !data}
        <div class="nova-loader" aria-label="Loading skills"></div>
    {:else if noProject}
        <p class="manage-empty">Project skills live in a folder's repository, so there is no project here. Open a folder in VS Code (File › Open Folder…) to create skills for it.</p>
    {:else}
        {#each sections as section (section.id)}
            <ManageSection title={section.title} hint={section.hint} count={section.rows.length}>
                {#if !section.rows.length}
                    <p class="manage-empty">
                        {scope === 'global'
                            ? 'No global skills yet. They are available in every project.'
                            : 'No project skills yet. They live in the repository, so your team gets them too.'}
                    </p>
                {/if}
                {#each section.rows as row (row.path + section.kind)}
                    {@const state = toggle(row, section.kind)}
                    <ManageItem name={row.name} description={row.description} location={section.kind === 'own' ? row.location : undefined} dimmed={!state.checked}>
                        {#snippet badges()}
                            {#if row.folder !== 'nova' && section.kind === 'own'}<span class="manage-badge">{row.folder}</span>{/if}
                            {#if row.enabled}<span class="manage-badge">in use</span>{/if}
                            {#if row.bundledBy}<span class="manage-badge" title={`Installed and kept up to date by ${row.bundledBy}. Read-only: you can only switch it off.`}><span class="codicon codicon-lock" aria-hidden="true"></span>bundled</span>{/if}
                        {/snippet}
                        {#snippet extra()}
                            <label class="check">
                                <input
                                    type="checkbox"
                                    checked={state.checked}
                                    disabled={state.disabled}
                                    onchange={(event) => post({command: 'skills/toggle', name: row.name, scope: state.target, enabled: (event.currentTarget as HTMLInputElement).checked})}
                                />
                                <span>{state.label}</span>
                            </label>
                            {#if state.note}<p class="manage-note">{state.note}</p>{/if}
                            {#if section.kind === 'own' && row.bundledBy}
                                <p class="manage-note">Bundled with {row.bundledBy}, which updates it. It can't be edited, moved or deleted; switch it off if you don't want it.</p>
                            {/if}
                        {/snippet}
                        {#snippet actions()}
                            {#if section.kind === 'own'}
                                <button class="manage-link" onclick={() => post({command: 'skills/open', path: row.path})}>{row.bundledBy ? 'View' : 'Edit'}</button>
                                <button class="manage-link" onclick={() => post({command: 'skills/reveal', path: row.path})}>Reveal</button>
                                {#if !row.bundledBy}
                                    {#if row.scope === 'project' || data.hasProject}
                                        <button class="manage-link" onclick={() => post({command: 'skills/move', path: row.path, to: row.scope === 'global' ? 'project' : 'global'})}>
                                            Move to {row.scope === 'global' ? 'Project' : 'Global'}
                                        </button>
                                    {/if}
                                    <button class="manage-link danger" onclick={() => post({command: 'skills/delete', path: row.path})}>Delete</button>
                                {/if}
                            {/if}
                        {/snippet}
                    </ManageItem>
                {/each}
            </ManageSection>
        {/each}
        {#if query && !shown}
            <p class="manage-empty">No skills match “{query}”.</p>
        {/if}
    {/if}
</ManagePage>

<style lang="scss">
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    cursor: pointer;

    input {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--vscode-settings-checkboxBackground, var(--nova-button-bg));
    }
  }
</style>
