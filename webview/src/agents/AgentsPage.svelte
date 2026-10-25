<script lang="ts">
    import type {AgentRow, AgentsPageData} from '../../../src/agents/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';

    let {data, post}: { data: AgentsPageData | undefined; post: (message: Record<string, unknown>) => void } = $props();

    let query = $state('');

    const inSource = (source: AgentRow['source']) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (data?.agents ?? []).filter((row) => row.source === source && words.every((word) =>
            `${row.name} ${row.description} ${row.location}`.toLowerCase().includes(word)));
    };
    const workspace = $derived(inSource('project'));
    const user = $derived(inSource('global'));
    const builtin = $derived(inSource('builtin'));

    const toolsText = (row: AgentRow) => row.tools ? `${row.tools.length} tools` : 'all tools';
</script>

{#snippet card(row: AgentRow)}
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
{/snippet}

{#snippet sectionActions(scope: 'global' | 'project', enabled: boolean)}
    <button class="manage-button" disabled={!enabled} onclick={() => post({command: 'agents/create', scope})}>
        <span class="codicon codicon-add" aria-hidden="true"></span> New Agent
    </button>
    <button class="manage-icon-button codicon codicon-folder-opened" disabled={!enabled} title="Open the agents folder" aria-label="Open the agents folder"
            onclick={() => post({command: 'agents/openFolder', scope})}></button>
{/snippet}
{#snippet workspaceActions()}{@render sectionActions('project', !!data?.hasProject)}{/snippet}
{#snippet userActions()}{@render sectionActions('global', true)}{/snippet}

<ManagePage title="Agents" description="A markdown file whose instructions are added to Nova's system prompt, and that can limit the tools Nova may use. Switch between agents with Shift+Tab in the chat."
            noun="agents" bind:query found={workspace.length + user.length + builtin.length}>
    {#if !data}
        <div class="nova-loader" aria-label="Loading agents"></div>
    {:else}
        <ManageSection title="Workspace" hint={data.folders.project} count={workspace.length} forceOpen={!!query} actions={workspaceActions}>
            {#if !data.hasProject}
                <p class="manage-empty">Open a folder in VS Code (File › Open Folder…) to create agents for it.</p>
            {:else if !workspace.length}
                <p class="manage-empty">{query ? `No workspace agents match “${query}”.` : 'No workspace agents yet. They are only used in this project.'}</p>
            {/if}
            {#each workspace as row (row.id)}{@render card(row)}{/each}
        </ManageSection>

        <ManageSection title="User" hint={data.folders.global} count={user.length} forceOpen={!!query} actions={userActions}>
            {#if !user.length}
                <p class="manage-empty">{query ? `No user agents match “${query}”.` : 'No user agents yet. They are available in every project.'}</p>
            {/if}
            {#each user as row (row.id)}{@render card(row)}{/each}
        </ManageSection>

        <ManageSection title="Built-in" hint="Bundled with Nova. They cannot be edited, replaced or deleted." count={builtin.length} forceOpen={!!query}>
            {#each builtin as row (row.id)}{@render card(row)}{/each}
        </ManageSection>
    {/if}
</ManagePage>
