<script lang="ts">
    import type {HookRow, HookScopeName, HooksPageData} from '../../../src/hooks/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';

    let {data, post}: { data: HooksPageData | undefined; post: (message: Record<string, unknown>) => void } = $props();

    let query = $state('');

    const matches = (row: HookRow) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const text = `${row.event} ${row.matcher ?? ''} ${row.command} ${row.location}`.toLowerCase();
        return words.every((word) => text.includes(word));
    };

    const workspace = $derived((data?.hooks ?? []).filter((row) => row.scope === 'workspace' && matches(row)));
    const user = $derived((data?.hooks ?? []).filter((row) => row.scope === 'user' && matches(row)));
    const shown = $derived(workspace.length + user.length);
    const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

    const ref = (row: HookRow) => ({file: row.file, event: row.event, group: row.group, index: row.index, command: row.command});
</script>

{#snippet card(row: HookRow)}
    <ManageItem name={row.event} icon="zap" description={row.command} location={row.location}
                note={row.scope === 'workspace' && data && !data.trusted ? 'Not run: this workspace is not trusted.' : undefined}
                dimmed={row.scope === 'workspace' && !!data && !data.trusted}>
        {#snippet badges()}
            {#if TOOL_EVENTS.has(row.event)}<span class="manage-badge" title="Tools it runs for">{row.matcher && row.matcher !== '*' ? row.matcher : 'all tools'}</span>{/if}
            {#if row.timeout && row.timeout !== 60}<span class="manage-badge" title="Timeout">{row.timeout}s</span>{/if}
            {#if row.kind === 'local'}<span class="manage-badge" title="In settings.local.json: yours, not committed">local</span>{/if}
            {#if row.kind === 'project'}<span class="manage-badge" title="Your private settings for this project">this project</span>{/if}
        {/snippet}
        {#snippet actions()}
            <button class="manage-link" onclick={() => post({command: 'hooks/open', ...ref(row)})}>Edit</button>
            <button class="manage-link danger" onclick={() => post({command: 'hooks/delete', ...ref(row)})}>Delete</button>
        {/snippet}
    </ManageItem>
{/snippet}

{#snippet sectionActions(scope: HookScopeName, enabled: boolean)}
    <button class="manage-button" disabled={!enabled} onclick={() => post({command: 'hooks/create', scope})}>
        <span class="codicon codicon-add" aria-hidden="true"></span> New Hook
    </button>
    <button class="manage-icon-button codicon codicon-go-to-file" disabled={!enabled} title="Open the settings file" aria-label="Open the settings file"
            onclick={() => post({command: 'hooks/openFile', scope})}></button>
{/snippet}

<ManagePage title="Hooks" description="Commands or scripts Nova runs at set points in a chat: before or after a tool, when you send a prompt, when it stops. Same format as Claude Code's hooks." noun="hooks" bind:query found={shown}>
    {#if !data}
        <div class="nova-loader" aria-label="Loading hooks"></div>
    {:else}
        <ManageSection title="Workspace" hint={data.files.workspace} count={workspace.length} forceOpen={!!query} actions={workspaceActions}>
            {#if !data.hasProject}
                <p class="manage-empty">Workspace hooks live in a folder's repository. Open a folder in VS Code (File › Open Folder…) to add hooks for it.</p>
            {:else}
                {#if !data.trusted}
                    <p class="manage-note">Workspace hooks only run once you trust this workspace, as a hook runs any command.</p>
                {/if}
                {#if !workspace.length}
                    <p class="manage-empty">{query ? `No workspace hooks match “${query}”.` : 'No workspace hooks yet. They are committed with the repository, so your team gets them too.'}</p>
                {/if}
            {/if}
            {#each workspace as row (`${row.file}#${row.event}#${row.group}#${row.index}`)}{@render card(row)}{/each}
        </ManageSection>

        <ManageSection title="User" hint={data.files.user} count={user.length} forceOpen={!!query} actions={userActions}>
            {#if !user.length}
                <p class="manage-empty">{query ? `No user hooks match “${query}”.` : 'No user hooks yet. They run in every project.'}</p>
            {/if}
            {#each user as row (`${row.file}#${row.event}#${row.group}#${row.index}`)}{@render card(row)}{/each}
        </ManageSection>
    {/if}
</ManagePage>

{#snippet workspaceActions()}{@render sectionActions('workspace', !!data?.hasProject)}{/snippet}
{#snippet userActions()}{@render sectionActions('user', true)}{/snippet}
