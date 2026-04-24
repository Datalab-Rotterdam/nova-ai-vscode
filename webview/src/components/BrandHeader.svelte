<script lang="ts">
  import type { ThemeMode } from '../types';

  export let heading: string;
  export let logoUri: string | undefined;
  export let theme: ThemeMode;
</script>

<header class="brand-header" data-theme={theme}>
  {#if logoUri}
    <div class="brand-mark">
      <img src={logoUri} alt="Nova AI logo" />
    </div>
  {/if}

  <div class="brand-copy">
    <h1>{heading}</h1>
    <p>Native Nova AI models for the VS Code chat surface.</p>
  </div>
</header>

