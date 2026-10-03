<script lang="ts">
    import type {ProfileView} from '../../../src/core/types';

    let {profile, size = 20}: { profile?: ProfileView; size?: number } = $props();

    let imageFailed = $state(false);
    const label = $derived(profile?.name ?? profile?.email ?? 'Account');
</script>

<!-- Picture, else initials, else a person icon. -->
<span class="avatar" style:--size={`${size}px`} title={profile?.email && profile.name ? `${profile.name} (${profile.email})` : label} role="img" aria-label={label}>
    {#if profile?.avatar && !imageFailed}
        <img src={profile.avatar} alt="" onerror={() => imageFailed = true}/>
    {:else if profile?.initials}
        <span class="initials">{profile.initials}</span>
    {:else}
        <span class="codicon codicon-account" aria-hidden="true"></span>
    {/if}
</span>

<style lang="scss">
  .avatar {
    width: var(--size);
    height: var(--size);
    flex: none;
    display: inline-grid;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    background: color-mix(in srgb, var(--nova-brand-primary) 22%, var(--nova-input-bg));
    color: var(--nova-fg);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .initials {
    font-size: calc(var(--size) * 0.42);
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
  }

  .codicon {
    font-size: calc(var(--size) * 0.75);
    color: var(--nova-muted);
  }
</style>
