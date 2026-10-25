<script lang="ts">
    import {onMount, untrack} from 'svelte';
    import type {ChatEvent} from '../../src/panel/protocol';
    import ChatView from './chat/ChatView.svelte';
    import AgentsPage from './agents/AgentsPage.svelte';
    import SkillsPage from './skills/SkillsPage.svelte';
    import SettingsPage from './settings/SettingsPage.svelte';
    import McpPage from './mcp/McpPage.svelte';
    import type {McpPageData} from '../../src/mcp/protocol';
    import ToolsPage from './tools/ToolsPage.svelte';
    import type {ToolsPageData} from '../../src/tools/protocol';
    import CustomizePage from './customize/CustomizePage.svelte';
    import type {SettingsPageData} from '../../src/settings/protocol';
    import type {AgentsPageData} from '../../src/agents/protocol';
    import type {SkillsPageData} from '../../src/skills/protocol';
    import {createChatStore} from './chat/store.svelte';
    import {SYNTAX_ROLES} from '../../src/views/syntaxColors';
    import type {ExtensionMessage, SidebarRenderState, SidebarView, VsCodeApi} from './types';
    import ApiKeyView from './views/ApiKeyView.svelte';
    import MainView from './views/MainView.svelte';
    import WelcomeView from './views/WelcomeView.svelte';

    let {initialState, vscode}: { initialState: SidebarRenderState; vscode: VsCodeApi | undefined } = $props();

    // Seeded once from the bootstrap state; later updates arrive as messages.
    let state = $state(untrack(() => initialState));
    let view = $state<SidebarView>(untrack(() => initialState.snapshot.hasApiKey) ? 'chat' : 'welcome');
    let signIn = $state<{ busy: boolean; error?: string }>({busy: false});
    const chat = createChatStore();
    /** The Chats page over the conversation (history button, title bar). */
    let chatsOpen = $state(false);
    /** The Customizations tab runs this same app with surface "customize". */
    const customizeSurface = untrack(() => initialState.surface === 'customize');
    let settings = $state<SettingsPageData | undefined>();
    let skills = $state<SkillsPageData | undefined>();
    let tools = $state<ToolsPageData | undefined>();
    let mcp = $state<McpPageData | undefined>();
    let customizePage: ReturnType<typeof CustomizePage> | undefined = $state();
    /** A tools group to open when the Tools page is shown from a link. */
    let toolsFocus = $state<{group: string; at: number} | undefined>();
    const manageTools = (group: string) => {
        toolsFocus = {group, at: Date.now()};
        customizePage?.show('tools');
    };
    let agents = $state<AgentsPageData | undefined>();

    // The editor theme's token colors, as --nova-syn-<role> variables for code in answers.
    $effect(() => {
        const colors = state.syntaxColors ?? {};
        for (const role of SYNTAX_ROLES) {
            const color = colors[role];
            if (color) {
                document.documentElement.style.setProperty(`--nova-syn-${role}`, color);
            } else {
                document.documentElement.style.removeProperty(`--nova-syn-${role}`);
            }
        }
    });

    onMount(() => {
        const onMessage = (event: MessageEvent<ExtensionMessage | ChatEvent>) => {
            const message = event.data;
            if (message.type === 'skills') {
                skills = (message as unknown as { data: SkillsPageData }).data;
            } else if (message.type === 'settings') {
                settings = (message as unknown as { data: SettingsPageData }).data;
            } else if (message.type === 'mcp') {
                mcp = (message as unknown as { data: McpPageData }).data;
            } else if (message.type === 'tools') {
                tools = (message as unknown as { data: ToolsPageData }).data;
            } else if (message.type === 'agents') {
                agents = (message as unknown as { data: AgentsPageData }).data;
            } else if (message.type.startsWith('chat/')) {
                chat.apply(message as ChatEvent);
                if (message.type === 'chat/state') {
                    // An editor tab reopens this chat after a window reload.
                    vscode?.setState?.({sessionId: (message as Extract<ChatEvent, {type: 'chat/state'}>).state.sessionId});
                }
            } else if (message.type === 'ui') {
                const action = (message as unknown as { action: 'history' | 'account' | 'chat' }).action;
                if (state.snapshot.hasApiKey) {
                    if (action === 'account') {
                        view = view === 'account' ? 'chat' : 'account';
                    } else if (action === 'history') {
                        chatsOpen = view === 'chat' ? !chatsOpen : true;
                        view = 'chat';
                    } else {
                        chatsOpen = false;
                        view = 'chat';
                    }
                }
            } else if (message.type === 'state') {
                const wasSignedIn = state.snapshot.hasApiKey;
                state = message.state;
                if (state.snapshot.hasApiKey && !wasSignedIn) {
                    view = 'chat';
                    post({command: 'chat/ready'});
                } else if (!state.snapshot.hasApiKey) {
                    view = view === 'apiKey' ? 'apiKey' : 'welcome';
                }
            } else if (message.type === 'signInResult') {
                signIn = {busy: false, error: message.ok ? undefined : message.error};
            }
        };

        window.addEventListener('message', onMessage);
        if (customizeSurface) {
            post({command: 'tools/ready'});
            post({command: 'mcp/ready'});
            post({command: 'skills/ready'});
            post({command: 'agents/ready'});
            post({command: 'settings/ready'});
            return () => window.removeEventListener('message', onMessage);
        }
        // Nova can sit in both sidebars; tell the extension which one is in use.
        const onFocus = () => post({command: 'focus'});
        window.addEventListener('focus', onFocus);
        post({command: 'ready'});
        post({command: 'chat/ready'});
        return () => {
            window.removeEventListener('message', onMessage);
            window.removeEventListener('focus', onFocus);
        };
    });

    function post(message: Record<string, unknown>) {
        vscode?.postMessage(message);
    }

    function connect(apiKey: string) {
        signIn = {busy: true};
        post({command: 'nova.signIn', apiKey});
    }
</script>

{#snippet SettingsSection()}
    <SettingsPage data={settings} {post}/>
{/snippet}
{#snippet ToolsSection()}
    <ToolsPage data={tools} {post} focus={toolsFocus}/>
{/snippet}
{#snippet McpSection()}
    <McpPage data={mcp} {post} onManageTools={manageTools}/>
{/snippet}
{#snippet AgentsSection()}
    <AgentsPage data={agents} {post}/>
{/snippet}
{#snippet SkillsSection()}
    <SkillsPage data={skills} {post}/>
{/snippet}

<svelte:head>
    <title>Nova AI</title>
</svelte:head>

{#if customizeSurface}
    <CustomizePage bind:this={customizePage} {vscode} {post} initial="tools" sections={[
        {id: 'tools', label: 'Tools', icon: 'tools', count: tools?.groups.reduce((sum, group) => sum + group.tools.length, 0), body: ToolsSection},
        {id: 'mcp', label: 'MCP Servers', icon: 'server', count: mcp?.servers.length, body: McpSection},
        {id: 'agents', label: 'Agents', icon: 'robot', count: agents?.agents.length, body: AgentsSection},
        {id: 'skills', label: 'Skills', icon: 'book', count: skills?.skills.length, body: SkillsSection},
        {id: 'settings', label: 'Settings', icon: 'settings-gear', body: SettingsSection}
    ]}/>
{:else if view === 'chat' && chat.state}
    <ChatView chat={chat.state} {post} logoUri={state.logoUri} surface={state.surface} profile={state.profile} onAccount={() => view = 'account'} {chatsOpen} onChats={(open) => chatsOpen = open}/>
{:else if view === 'chat'}
    <div class="nova-loader" aria-label="Loading Nova chat"></div>
{:else if view === 'account'}
    <MainView {state} {post} onBack={() => view = 'chat'}/>
{:else if view === 'apiKey'}
    <ApiKeyView busy={signIn.busy} error={signIn.error ?? state.snapshot.lastError} onConnect={connect} onBack={() => view = 'welcome'}/>
{:else}
    <WelcomeView {state} onGetStarted={() => view = 'apiKey'}/>
{/if}
