<script lang="ts">
    import {onMount, untrack} from 'svelte';
    import type {ChatEvent} from '../../src/panel/protocol';
    import ChatView from './chat/ChatView.svelte';
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
    let historyToggle = $state(0);

    onMount(() => {
        const onMessage = (event: MessageEvent<ExtensionMessage | ChatEvent>) => {
            const message = event.data;
            if (message.type.startsWith('chat/')) {
                chat.apply(message as ChatEvent);
            } else if (message.type === 'ui') {
                const action = (message as unknown as { action: 'history' | 'account' }).action;
                if (state.snapshot.hasApiKey) {
                    if (action === 'account') {
                        view = view === 'account' ? 'chat' : 'account';
                    } else {
                        view = 'chat';
                        historyToggle++;
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

{#if view === 'chat' && chat.state}
    <ChatView chat={chat.state} {post} logoUri={state.logoUri} surface={state.surface} {historyToggle} profile={state.profile} onAccount={() => view = 'account'}/>
{:else if view === 'chat'}
    <div class="nova-loader" aria-label="Loading Nova chat"></div>
{:else if view === 'account'}
    <MainView {state} {post} onBack={() => view = 'chat'}/>
{:else if view === 'apiKey'}
    <ApiKeyView busy={signIn.busy} error={signIn.error ?? state.snapshot.lastError} onConnect={connect} onBack={() => view = 'welcome'}/>
{:else}
    <WelcomeView {state} onGetStarted={() => view = 'apiKey'}/>
{/if}
