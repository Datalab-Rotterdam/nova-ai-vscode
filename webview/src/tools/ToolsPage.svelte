<script lang="ts">
    import type {ToolGroup, ToolScopeName, ToolsPageData} from '../../../src/tools/protocol';
    import ManagePage from '../manage/ManagePage.svelte';
    import {tick} from 'svelte';
    import ManageItem from '../manage/ManageItem.svelte';
    import ManageSection from '../manage/ManageSection.svelte';
    import Toggle from '../manage/Toggle.svelte';

    let {data, post, focus}: {
        data: ToolsPageData | undefined;
        post: (message: Record<string, unknown>) => void;
        /** A group to open and scroll to, such as an MCP server's (set by a link on another page). */
        focus?: {group: string; at: number};
    } = $props();

    let query = $state('');
    const scope = $derived<ToolScopeName>(data?.scope ?? 'user');

    const groups = $derived.by((): ToolGroup[] => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (data?.groups ?? [])
            .map((group) => ({
                ...group,
                tools: words.length ? group.tools.filter((tool) => words.every((word) => `${tool.name} ${tool.description} ${group.title}`.toLowerCase().includes(word))) : group.tools
            }))
            .filter((group) => group.tools.length);
    });
    const found = $derived(groups.reduce((total, group) => total + group.tools.length, 0));
    const total = $derived((data?.groups ?? []).reduce((sum, group) => sum + group.tools.length, 0));
    const on = $derived((data?.groups ?? []).reduce((sum, group) => sum + group.tools.filter((tool) => tool.enabled).length, 0));
    /** The groups under their category, in the order the extension sent them. */
    const categories = $derived.by(() => {
        const list: Array<{title: string; groups: ToolGroup[]}> = [];
        for (const group of groups) {
            (list.find((category) => category.title === group.category) ?? list[list.push({title: group.category, groups: []}) - 1]).groups.push(group);
        }
        return list;
    });
    const count = (list: ToolGroup[]) => list.reduce((sum, group) => sum + group.tools.length, 0);
    const enabledIn = (list: ToolGroup[]) => list.reduce((sum, group) => sum + group.tools.filter((tool) => tool.enabled).length, 0);
    const namesOf = (list: ToolGroup[]) => list.flatMap((group) => group.tools.map((tool) => tool.name));

    const slug = (title: string) => `tools-group-${title.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const focused = (group: ToolGroup) => !!focus && focus.group.replace(/[^a-zA-Z0-9_-]/g, '_') === group.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    $effect(() => {
        const target = focus && groups.find(focused);
        if (target) {
            void tick().then(() => document.getElementById(slug(target.title))?.scrollIntoView({block: 'center', behavior: 'smooth'}));
        }
    });

    const set = (names: string[], enabled: boolean) => post({command: 'tools/set', names, enabled});
    const firstLine = (text: string) => text.split('\n')[0];
</script>

<ManagePage title="Tools" description="The tools Nova may use. A tool that is off is not offered to the model." noun="tools" bind:query {found} scope={scope}
            onScope={(id) => post({command: 'tools/scope', scope: id})}
            tabs={[
                {id: 'user', label: 'User', title: 'Tools for you, in every project'},
                {id: 'project', label: 'Workspace', disabled: !data?.hasProject, title: data?.hasProject ? 'Tools for this workspace; they win over your user settings' : 'Open a folder for workspace tools'}
            ]}>
    {#snippet summary()}
        {on} of {total} tools are on. Tools a chat adds for itself (ask, to-do, sub-agents) follow their own settings.
    {/snippet}

    {#each categories as category (category.title)}
        {@const enabled = enabledIn(category.groups)}
        {#snippet categorySwitch()}
            <span class="small">{enabled}/{count(category.groups)}</span>
            <Toggle checked={enabled > 0} label="{enabled > 0 ? 'Turn off' : 'Turn on'} {category.title}" onchange={(checked) => set(namesOf(category.groups), checked)}/>
        {/snippet}
        <ManageSection title={category.title} count={category.groups.length} open={category.title === 'Built-in Tools' || category.groups.some(focused)} forceOpen={!!query} actions={categorySwitch}>
            {#each category.groups as group (group.title)}
                {@const groupOn = group.tools.filter((tool) => tool.enabled).length}
                <div id={slug(group.title)}>
                <ManageItem name={group.title} description={group.description} open={focused(group)} forceOpen={!!query} dimmed={groupOn === 0}>
                    {#snippet badges()}
                        <span class="manage-badge">{groupOn}/{group.tools.length}</span>
                    {/snippet}
                    {#snippet control()}
                        <Toggle checked={groupOn > 0} label="{groupOn > 0 ? 'Turn off' : 'Turn on'} {group.title}" onchange={(checked) => set(group.tools.map((tool) => tool.name), checked)}/>
                    {/snippet}
                    {#snippet extra()}
                        <ul>
                            {#each group.tools as tool (tool.name)}
                                <li class:off={!tool.enabled}>
                                    <div class="text">
                                        <div class="name">
                                            <code>{tool.name}</code>
                                            {#if tool.readOnly}<span class="manage-badge">read-only</span>{/if}
                                            {#if tool.inherited}<span class="manage-badge" title="Turned off in your user tools">off for you</span>{/if}
                                        </div>
                                        <div class="tool-description" title={tool.description}>{firstLine(tool.description)}</div>
                                    </div>
                                    <Toggle checked={tool.enabled} label="{tool.enabled ? 'Turn off' : 'Turn on'} {tool.name}" onchange={(checked) => set([tool.name], checked)}/>
                                </li>
                            {/each}
                        </ul>
                    {/snippet}
                </ManageItem>
                </div>
            {/each}
        </ManageSection>
    {:else}
        <p class="manage-empty">{data ? 'No tools match.' : 'Loading tools…'}</p>
    {/each}
</ManagePage>

<style lang="scss">
  .small {
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  ul {
    margin: 8px 0 0 22px;
    padding: 0;
    border-top: 1px solid var(--vscode-settings-headerBorder, var(--nova-border));
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;

    &.off {
      opacity: 0.65;
    }

    .text {
      flex: 1;
      min-width: 0;
    }

    .name {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .tool-description {
      overflow: hidden;
      color: var(--nova-muted);
      font-size: 0.9em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>
