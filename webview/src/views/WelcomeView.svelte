<script lang="ts">
  import type { SidebarRenderState, ThemeMode } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let onGetStarted: () => void;
</script>

<section class="signed-out" data-theme={theme}>
  {#if state.backgroundVideoUri}
    <video class="background-video" src={state.backgroundVideoUri} autoplay muted loop playsinline aria-hidden="true"></video>
  {/if}

  <div class="video-scrim"></div>

  <div class="welcome-hero">
    {#if state.logoUri}
      <img class="welcome-logo" src={state.logoUri} alt="Nova AI" />
    {/if}
    <h1>Reimagine how you connect with Artificial Intelligence.</h1>
    <button class="get-started" onclick={onGetStarted}>Get Started</button>
  </div>
</section>

