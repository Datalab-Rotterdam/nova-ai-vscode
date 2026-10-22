<script lang="ts">
    import {untrack} from 'svelte';
    import type {AgentRow, AgentsPageData} from '../../../src/agents/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';

    type Tab = 'builtin' | 'global' | 'project';

    let {data, post, initialScope = 'builtin', onScope}: {
        data: AgentsPageData | undefined;
        post: (message: Record<string, unknown>) => void;
        /** The tab shown first (kept across reloads by the caller). */
        initialScope?: Tab;
        onScope?: (scope: Tab) => void;
    } = $props();

    let scope = $state<Tab>(untrack(() => initialScope));
    let query = $state('');

    const rows = $derived.by(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (data?.agents ?? []).filter((row) => row.source === scope && words.every((word) =>
            `${row.name} ${row.description} ${row.location}`.toLowerCase().includes(word)));
    });

    const canCreate = $derived(scope !== 'builtin' && (scope === 'global' || Boolean(data?.hasProject)));
    const hint = $derived(scope === 'builtin'
        ? 'Bundled with Nova. They cannot be edited, replaced or deleted. Switch between agents with Shift+Tab in the chat.'
        : scope === 'global' ? data?.folders.global : data?.folders.project);

    function toolsText(row: AgentRow): string {
        return row.tools ? `${row.tools.length} tools` : 'all tools';
    }
</script>

<ManagePage
    noun="agents"
    bind:query
    found={rows.length}
    tabs={[
        {id: 'builtin', label: 'Built in'},
        {id: 'global', label: 'Global'},
        {id: 'project', label: 'Project'}
    ]}
    {scope}
    onScope={(id) => { scope = id as Tab; onScope?.(scope); }}
    onCreate={() => post({command: 'agents/create', scope})}
    createLabel="New Agent"
    {canCreate}
    onOpenFolder={scope === 'builtin' ? undefined : () => post({command: 'agents/openFolder', scope})}
>
    {#snippet summary()}
        An agent is a markdown file whose instructions are added to Nova's system prompt, and that can limit the tools Nova may use.
    {/snippet}

    {#if !data}
        <div class="nova-loader" aria-label="Loading agents"></div>
    {:else if scope === 'project' && !data.hasProject}
        <p class="manage-empty">There is no project here. Open a folder in VS Code (File › Open Folder…) to create agents for it.</p>
    {:else}
        <ManageSection title={scope === 'builtin' ? 'Built-in agents' : scope === 'global' ? 'Global agents' : 'Project agents'} {hint} count={rows.length}>
            {#if !rows.length}
                <p class="manage-empty">
                    {#if query}
                        No agents match “{query}”.
                    {:else if scope === 'global'}
                        No global agents yet. They are available in every project.
                    {:else}
                        No project agents yet. They are only used in this project.
                    {/if}
                </p>
                {#if !query && canCreate}
                    <div><button class="manage-link" onclick={() => post({command: 'agents/create', scope})}>Create the first one</button></div>
                {/if}
            {/if}
            {#each rows as row (row.id)}
                <ManageItem name={row.name} icon={row.icon} description={row.description} location={row.path ? row.location : undefined}>
                    {#snippet badges()}
                        {#if row.readOnly}<span class="manage-badge" title="Only tools that change nothing">read-only</span>{/if}
                        {#if row.autopilot}<span class="manage-badge" title="No tool round limit; ask_user answers itself">autopilot</span>{/if}
                        <span class="manage-badge" title={row.tools?.join(', ') ?? 'Every tool'}>{toolsText(row)}</span>
                        {#if row.source === 'builtin'}<span class="manage-badge" title="Bundled with Nova: read-only"><span class="codicon codicon-lock" aria-hidden="true"></span>built in</span>{/if}
                    {/snippet}
                    {#snippet actions()}
                        {#if row.path}
                            <button class="manage-link" onclick={() => post({command: 'agents/open', path: row.path})}>{row.source === 'builtin' ? 'View' : 'Edit'}</button>
                            <button class="manage-link" onclick={() => post({command: 'agents/reveal', path: row.path})}>Reveal</button>
                            {#if row.source !== 'builtin'}
                                <button class="manage-link danger" onclick={() => post({command: 'agents/delete', path: row.path})}>Delete</button>
                            {/if}
                        {/if}
                    {/snippet}
                </ManageItem>
            {/each}
        </ManageSection>
    {/if}
</ManagePage>
