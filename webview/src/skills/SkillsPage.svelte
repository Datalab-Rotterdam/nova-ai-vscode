<script lang="ts">
    import type {SkillRow, SkillScopeName, SkillsPageData} from '../../../src/skills/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';
    import Toggle from '../manage/Toggle.svelte';

    let {data, post}: { data: SkillsPageData | undefined; post: (message: Record<string, unknown>) => void } = $props();

    let query = $state('');

    const matches = (row: SkillRow) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const text = `${row.name} ${row.description} ${row.location}`.toLowerCase();
        return words.every((word) => text.includes(word));
    };

    const workspace = $derived((data?.skills ?? []).filter((row) => row.scope === 'project' && matches(row)));
    const user = $derived((data?.skills ?? []).filter((row) => row.scope === 'global' && matches(row)));
    /** The user skills this workspace sees, to switch off here only. */
    const inWorkspace = $derived(data?.hasProject ? (data.skills).filter((row) => row.scope === 'global' && !row.replacedBy && matches(row)) : []);
    const shown = $derived(workspace.length + user.length);

    type Kind = 'own' | 'user-in-workspace';

    /** The switch of a card: which setting it changes and whether it can. */
    function toggle(row: SkillRow, kind: Kind): { checked: boolean; disabled: boolean; label: string; note?: string; target: SkillScopeName } {
        if (row.replacedBy) {
            return {checked: false, disabled: true, label: 'Not used', note: `${row.replacedBy} has the same name and is used instead.`, target: row.scope};
        }
        if (kind === 'user-in-workspace') {
            return row.offGlobally
                ? {checked: false, disabled: true, label: 'Use in this workspace', note: 'Switched off for every project (in User).', target: 'project'}
                : {checked: !row.offInProject, disabled: false, label: 'Use in this workspace', target: 'project'};
        }
        if (row.scope === 'global') {
            return {
                checked: !row.offGlobally,
                disabled: false,
                label: 'Use in every project',
                note: !row.offGlobally && row.offInProject ? 'Switched off in this workspace.' : undefined,
                target: 'global'
            };
        }
        return row.offGlobally
            ? {checked: false, disabled: true, label: 'Use in this workspace', note: 'A skill with this name is switched off for every project (in User).', target: 'project'}
            : {checked: !row.offInProject, disabled: false, label: 'Use in this workspace', target: 'project'};
    }
</script>

{#snippet card(row: SkillRow, kind: Kind)}
    {@const state = toggle(row, kind)}
    <ManageItem name={row.name} description={row.description} location={kind === 'own' ? row.location : undefined} note={state.note} dimmed={!state.checked}>
        {#snippet badges()}
            {#if row.folder !== 'nova' && kind === 'own'}<span class="manage-badge">{row.folder}</span>{/if}
            {#if row.bundledBy}<span class="manage-badge" title={`Installed and kept up to date by ${row.bundledBy}. Read-only: you can only switch it off.`}><span class="codicon codicon-lock" aria-hidden="true"></span>bundled</span>{/if}
        {/snippet}
        {#snippet control()}
            <Toggle checked={state.checked} disabled={state.disabled} label={state.label}
                    onchange={(enabled) => post({command: 'skills/toggle', name: row.name, scope: state.target, enabled})}/>
        {/snippet}
        {#snippet extra()}
            {#if kind === 'own' && row.bundledBy}
                <p class="manage-note">Bundled with {row.bundledBy}, which updates it. It can't be edited, moved or deleted; switch it off if you don't want it.</p>
            {/if}
        {/snippet}
        {#snippet actions()}
            {#if kind === 'own'}
                <button class="manage-link" onclick={() => post({command: 'skills/open', path: row.path})}>{row.bundledBy ? 'View' : 'Edit'}</button>
                <button class="manage-link" onclick={() => post({command: 'skills/reveal', path: row.path})}>Reveal</button>
                {#if !row.bundledBy}
                    {#if row.scope === 'project' || data?.hasProject}
                        <button class="manage-link" onclick={() => post({command: 'skills/move', path: row.path, to: row.scope === 'global' ? 'project' : 'global'})}>
                            Move to {row.scope === 'global' ? 'Workspace' : 'User'}
                        </button>
                    {/if}
                    <button class="manage-link danger" onclick={() => post({command: 'skills/delete', path: row.path})}>Delete</button>
                {/if}
            {/if}
        {/snippet}
    </ManageItem>
{/snippet}

{#snippet sectionActions(scope: SkillScopeName, enabled: boolean)}
    <button class="manage-button" disabled={!enabled} onclick={() => post({command: 'skills/create', scope})}>
        <span class="codicon codicon-add" aria-hidden="true"></span> New Skill
    </button>
    <button class="manage-icon-button codicon codicon-folder-opened" disabled={!enabled} title="Open the skills folder" aria-label="Open the skills folder"
            onclick={() => post({command: 'skills/openFolder', scope})}></button>
{/snippet}

<ManagePage title="Skills" description="Folders of instructions, scripts and resources that Nova loads when they are relevant to a task." noun="skills" bind:query found={shown}>
    {#snippet summary()}
        {#if data}
            <span title="Only names and short descriptions are in every request; Nova reads a skill's instructions when it uses it.">
                {data.enabledCount} in use · about {data.promptTokens.toLocaleString()} tokens per request
            </span>
        {/if}
    {/snippet}

    {#if !data}
        <div class="nova-loader" aria-label="Loading skills"></div>
    {:else}
        <ManageSection title="Workspace" hint={data.hasProject ? data.folders.project : undefined} count={workspace.length} forceOpen={!!query} actions={workspaceActions}>
            {#if !data.hasProject}
                <p class="manage-empty">Workspace skills live in a folder's repository. Open a folder in VS Code (File › Open Folder…) to create skills for it.</p>
            {:else if !workspace.length}
                <p class="manage-empty">{query ? `No workspace skills match “${query}”.` : 'No workspace skills yet. They live in the repository, so your team gets them too.'}</p>
            {/if}
            {#each workspace as row (row.path)}{@render card(row, 'own')}{/each}
        </ManageSection>

        <ManageSection title="User" hint={data.folders.global} count={user.length} forceOpen={!!query} actions={userActions}>
            {#if !user.length}
                <p class="manage-empty">{query ? `No user skills match “${query}”.` : 'No user skills yet. They are available in every project.'}</p>
            {/if}
            {#each user as row (row.path)}{@render card(row, 'own')}{/each}
        </ManageSection>

        {#if inWorkspace.length}
            <ManageSection title="User skills in this workspace" hint="Switching one off here keeps it for other projects." count={inWorkspace.length} open={false} forceOpen={!!query}>
                {#each inWorkspace as row (row.path)}{@render card(row, 'user-in-workspace')}{/each}
            </ManageSection>
        {/if}
    {/if}
</ManagePage>

{#snippet workspaceActions()}{@render sectionActions('project', !!data?.hasProject)}{/snippet}
{#snippet userActions()}{@render sectionActions('global', true)}{/snippet}
