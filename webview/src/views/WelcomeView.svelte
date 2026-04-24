<script lang="ts">
  import type { SidebarRenderState, ThemeMode } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let onGetStarted: () => void;

  const datalabLogoUri = 'https://git.datalabrotterdam.nl/websites/resources/-/raw/main/logos/datalab_logo_light.svg?ref_type=heads';
</script>

<section class="signed-out" data-theme={theme}>
  <div class="splash-hero" aria-hidden="true">
    <div class="hero-ring ring-one"></div>
    <div class="hero-ring ring-two"></div>
    <div class="hero-core">
      {#if state.logoUri}
        <img class="hero-logo" src={state.logoUri} alt="" />
      {/if}
    </div>
  </div>

  <div class="welcome-copy">
    <p class="welcome-title">Bring Nova AI into VS Code.</p>
    <p>Connect your API key and use Nova AI from the native chat surface.</p>
  </div>

  <button class="get-started" onclick={onGetStarted}>Get Started</button>

  <footer class="datalab-footer" aria-label="Datalab Rotterdam">
    <img src={datalabLogoUri} alt="Datalab Rotterdam" />
  </footer>
</section>

<style lang="scss">
  .signed-out {
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto auto auto 1fr;
    align-content: start;
    gap: 18px;
    padding: 14px 12px 16px;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
  }

  .splash-hero {
    height: 156px;
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background:
      radial-gradient(circle at center, color-mix(in srgb, var(--accent) 18%, transparent), transparent 58%),
      color-mix(in srgb, var(--input-bg) 76%, var(--bg));
  }

  .hero-ring {
    position: absolute;
    border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent);
    border-radius: 50%;
    opacity: 0.7;
    animation: pulse-ring 4.4s ease-in-out infinite;
  }

  .ring-one {
    width: 112px;
    height: 112px;
  }

  .ring-two {
    width: 146px;
    height: 146px;
    animation-delay: 1.1s;
    opacity: 0.42;
  }

  .hero-core {
    width: 76px;
    height: 76px;
    position: relative;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
    border-radius: 22px;
    background: color-mix(in srgb, var(--bg) 86%, var(--fg) 14%);
    box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 20%, transparent);
    animation: float-core 5.2s ease-in-out infinite;
  }

  .hero-core::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: linear-gradient(120deg, transparent 22%, color-mix(in srgb, var(--fg) 18%, transparent), transparent 76%);
    opacity: 0.5;
    animation: shimmer 3.6s ease-in-out infinite;
  }

  .hero-logo {
    width: 42px;
    height: 42px;
    position: relative;
    z-index: 1;
    object-fit: contain;
  }

  .welcome-copy {
    display: grid;
    gap: 8px;
  }

  p {
    margin: 0;
  }

  .welcome-title {
    color: var(--fg);
    font-size: 21px;
    line-height: 1.15;
    font-weight: 680;
  }

  p {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .get-started {
    min-height: 40px;
    padding: 10px 12px;
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 650;
  }

  .datalab-footer {
    align-self: end;
    display: flex;
    justify-content: center;
    padding-top: 12px;
    opacity: 0.56;
  }

  .datalab-footer img {
    width: min(118px, 42vw);
    max-height: 34px;
    object-fit: contain;
  }

  @keyframes pulse-ring {
    0%,
    100% {
      transform: scale(0.96);
      opacity: 0.42;
    }

    50% {
      transform: scale(1.04);
      opacity: 0.78;
    }
  }

  @keyframes float-core {
    0%,
    100% {
      transform: translateY(0);
    }

    50% {
      transform: translateY(-4px);
    }
  }

  @keyframes shimmer {
    0%,
    100% {
      transform: translateX(-42%);
    }

    50% {
      transform: translateX(42%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-ring,
    .hero-core,
    .hero-core::after {
      animation: none;
    }
  }
</style>
