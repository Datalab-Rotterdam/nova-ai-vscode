<script lang="ts">
  import AccountCard from '../components/AccountCard.svelte';
  import BrandHeader from '../components/BrandHeader.svelte';
  import type { SidebarRenderState, ThemeMode, VsCodeApi } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let vscode: VsCodeApi | undefined;
</script>

<BrandHeader heading="Nova AI connected" logoUri={state.logoUri} {theme} />
<AccountCard {state} {theme} {vscode} />

