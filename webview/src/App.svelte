<script lang="ts">
    import {onMount, untrack} from 'svelte';
    import type {ChatEvent} from '../../src/panel/protocol';
    import ChatView from './chat/ChatView.svelte';
    import SkillsPage from './skills/SkillsPage.svelte';
    import type {SkillScopeName, SkillsPageData} from '../../src/skills/protocol';
    import {createChatStore} from './chat/store.svelte';
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
    /** The Skills tab runs this same app with surface "skills". */
    const skillsSurface = untrack(() => initialState.surface === 'skills');
    let skills = $state<SkillsPageData | undefined>();
    const savedScope = (vscode?.getState?.() as { scope?: SkillScopeName } | undefined)?.scope;

    onMount(() => {
        const onMessage = (event: MessageEvent<ExtensionMessage | ChatEvent>) => {
            const message = event.data;
            if (message.type === 'skills') {
                skills = (message as unknown as { data: SkillsPageData }).data;
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
        if (skillsSurface) {
            post({command: 'skills/ready'});
            return () => window.removeEventListener('message', onMessage);
        }
        post({command: 'ready'});
        post({command: 'chat/ready'});
        return () => window.removeEventListener('message', onMessage);
    });

    function post(message: Record<string, unknown>) {
        vscode?.postMessage(message);
    }

    function connect(apiKey: string) {
        signIn = {busy: true};
        post({command: 'nova.signIn', apiKey});
    }
</script>

<svelte:head>
    <title>Nova AI</title>
</svelte:head>

{#if skillsSurface}
    <SkillsPage data={skills} {post} initialScope={savedScope ?? 'global'} onScope={(scope) => vscode?.setState?.({scope})}/>
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
