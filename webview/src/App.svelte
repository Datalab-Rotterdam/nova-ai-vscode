<script lang="ts">
    import {onMount} from 'svelte';
    import {detectThemeMode} from './theme';
    import type {HostStateMessage, SidebarRenderState, SidebarView, ThemeMode, VsCodeApi} from './types';
    import ApiKeyView from './views/ApiKeyView.svelte';
    import MainView from './views/MainView.svelte';
    import WelcomeView from './views/WelcomeView.svelte';

    export let initialState: SidebarRenderState;
    export let vscode: VsCodeApi | undefined;

    let state = initialState;
    let theme: ThemeMode = 'dark';
    let currentView: SidebarView = state.snapshot.hasApiKey ? 'main' : 'welcome';

    onMount(() => {
        const updateTheme = () => {
            theme = detectThemeMode(document.body);
        };

        const onMessage = (event: MessageEvent<HostStateMessage>) => {
            if (event.data?.type !== 'state') {
                return;
            }

            state = event.data.state;
            currentView = state.snapshot.hasApiKey ? 'main' : 'welcome';
            vscode?.setState?.(state);
        };

        updateTheme();

        const observer = new MutationObserver(updateTheme);
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        window.addEventListener('message', onMessage);

        return () => {
            observer.disconnect();
            window.removeEventListener('message', onMessage);
        };
    });
</script>

<svelte:head>
    <title>Nova AI</title>
</svelte:head>

<div class="shell" data-theme={theme}>
    {#if currentView === 'main'}
        <MainView {state} {theme} {vscode}/>
    {:else if currentView === 'apiKey'}
        <ApiKeyView {state} {theme} {vscode} onBack={() => currentView = 'welcome'}/>
    {:else}
        <WelcomeView {state} {theme} onGetStarted={() => currentView = 'apiKey'}/>
    {/if}
</div>
