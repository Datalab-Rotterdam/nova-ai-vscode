<script lang="ts">
  import { onMount } from 'svelte';
  import { detectThemeMode } from './theme';
  import type { SidebarRenderState, SidebarView, ThemeMode, VsCodeApi } from './types';
  import AccountView from './views/AccountView.svelte';
  import CreateApiKeyView from './views/CreateApiKeyView.svelte';
  import WelcomeView from './views/WelcomeView.svelte';

  export let initialState: SidebarRenderState;
  export let vscode: VsCodeApi | undefined;

  const state = initialState;
  let theme: ThemeMode = 'dark';
  let currentView: SidebarView = state.snapshot.hasApiKey ? 'account' : 'welcome';

  onMount(() => {
    const updateTheme = () => {
      theme = detectThemeMode(document.body);
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  });
</script>

<svelte:head>
  <title>Nova AI</title>
</svelte:head>

<div class="shell" data-theme={theme}>
  {#if currentView === 'account'}
    <AccountView {state} {theme} {vscode} />
  {:else if currentView === 'createApiKey'}
    <CreateApiKeyView {state} {theme} {vscode} onBack={() => currentView = 'welcome'} />
  {:else}
    <WelcomeView {state} {theme} onGetStarted={() => currentView = 'createApiKey'} />
  {/if}
</div>
