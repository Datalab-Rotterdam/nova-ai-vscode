<script lang="ts">
    import type {McpPageData, McpRow} from '../../../src/mcp/protocol';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManagePage from '../manage/ManagePage.svelte';
    import ManageSection from '../manage/ManageSection.svelte';
    import Toggle from '../manage/Toggle.svelte';

    let {data, post, onManageTools}: {
        data: McpPageData | undefined;
        post: (message: Record<string, unknown>) => void;
        /** Opens the Tools page at the group of this server. */
        onManageTools: (server: string) => void;
    } = $props();

    let query = $state('');

    const STATUS: Record<McpRow['status'], string> = {
        connected: 'connected',
        connecting: 'connecting…',
        'needs-auth': 'sign in needed',
        error: 'error',
        disabled: 'off'
    };

    const inScope = (scope: McpRow['scope']) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (data?.servers ?? []).filter((row) => row.scope === scope && words.every((word) => `${row.name} ${row.target ?? ''} ${row.type}`.toLowerCase().includes(word)));
    };
    const workspace = $derived(inScope('project'));
    const user = $derived(inScope('user'));
    const http = (row: McpRow) => row.type === 'http' || row.type === 'sse';
</script>

{#snippet card(row: McpRow)}
    <ManageItem name={row.name} icon="server" description={row.target ?? row.error?.split('\n')[0] ?? ''} dimmed={row.status === 'disabled'}
                note={row.status === 'needs-auth' ? 'This server needs you to sign in.' : row.status === 'error' ? row.error?.split('\n')[0] : undefined}>
        {#snippet badges()}
            <span class="manage-badge status {row.status}">{STATUS[row.status]}</span>
            {#if row.type !== 'invalid'}<span class="manage-badge">{row.type}</span>{/if}
            {#if row.status === 'connected'}<span class="manage-badge">{row.tools} {row.tools === 1 ? 'tool' : 'tools'}</span>{/if}
        {/snippet}
        {#snippet control()}
            {#if row.type !== 'invalid'}
                <Toggle checked={row.status !== 'disabled'} label={row.status === 'disabled' ? `Turn on ${row.name}` : `Turn off ${row.name}`}
                        onchange={(on) => post({command: 'mcp/setDisabled', name: row.name, disabled: !on})}/>
            {/if}
        {/snippet}
        {#snippet extra()}
            {#if row.error}<pre class="error">{row.error}</pre>{/if}
        {/snippet}
        {#snippet actions()}
            {#if row.status === 'connected' && row.tools > 0}
                <button class="manage-link" onclick={() => onManageTools(row.name)}>Manage tools</button>
            {/if}
            {#if http(row) && row.status !== 'disabled'}
                <button class="manage-link" onclick={() => post({command: 'mcp/signIn', name: row.name})}>{row.signedIn ? 'Sign in again' : 'Sign in'}</button>
            {/if}
            {#if row.status !== 'disabled' && row.type !== 'invalid'}
                <button class="manage-link" onclick={() => post({command: 'mcp/reconnect', name: row.name})}>Reconnect</button>
            {/if}
            {#if row.signedIn}<button class="manage-link" onclick={() => post({command: 'mcp/signOut', name: row.name})}>Sign out</button>{/if}
            <button class="manage-link" onclick={() => post({command: 'mcp/openConfig', scope: row.scope})}>Edit config</button>
            <button class="manage-link danger" onclick={() => post({command: 'mcp/delete', name: row.name, scope: row.scope})}>Delete</button>
        {/snippet}
    </ManageItem>
{/snippet}

{#snippet sectionActions(scope: 'user' | 'project', enabled: boolean)}
    <button class="manage-button" disabled={!enabled} onclick={() => post({command: 'mcp/add', scope})}>
        <span class="codicon codicon-add" aria-hidden="true"></span> Add Server
    </button>
    <button class="manage-icon-button codicon codicon-go-to-file" disabled={!enabled} title="Open the config file" aria-label="Open the config file"
            onclick={() => post({command: 'mcp/openConfig', scope})}></button>
{/snippet}
{#snippet workspaceActions()}{@render sectionActions('project', !!data?.hasProject)}{/snippet}
{#snippet userActions()}{@render sectionActions('user', true)}{/snippet}

<ManagePage title="MCP Servers" description="Model Context Protocol servers give Nova more tools, such as GitHub, databases or your own services. Their tools appear under Tools › Connected Sources."
            noun="servers" bind:query found={workspace.length + user.length}>
    {#if !data}
        <div class="nova-loader" aria-label="Loading MCP servers"></div>
    {:else}
        <ManageSection title="Workspace" hint={data.files.project} count={workspace.length} forceOpen={!!query} actions={workspaceActions}>
            {#if !data.hasProject}
                <p class="manage-empty">Open a folder in VS Code (File › Open Folder…) to add servers for it.</p>
            {:else if !workspace.length}
                <p class="manage-empty">{query ? `No workspace servers match “${query}”.` : 'No workspace servers yet. They live in the repository (.nova-ai/mcp.json or .mcp.json), so your team gets them too.'}</p>
            {/if}
            {#each workspace as row (row.name + row.scope)}{@render card(row)}{/each}
        </ManageSection>

        <ManageSection title="User" hint={data.files.user} count={user.length} forceOpen={!!query} actions={userActions}>
            {#if !user.length}
                <p class="manage-empty">{query ? `No user servers match “${query}”.` : 'No user servers yet. They are available in every project.'}</p>
            {/if}
            {#each user as row (row.name + row.scope)}{@render card(row)}{/each}
        </ManageSection>
    {/if}
</ManagePage>

<style lang="scss">
  .status {
    &.connected {
      color: var(--vscode-testing-iconPassed, var(--nova-badge-fg));
    }

    &.error {
      color: var(--nova-error);
    }

    &.needs-auth {
      color: var(--nova-warning);
    }
  }

  .error {
    margin: 8px 0 0 22px;
    overflow-x: auto;
    color: var(--nova-error);
    font-family: var(--nova-mono);
    font-size: 0.85em;
    white-space: pre-wrap;
  }
</style>
