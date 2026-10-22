<script lang="ts">
  import { closeImage, viewer } from "./viewer.svelte";

  function onKeydown(event: KeyboardEvent) {
    if (viewer.image && event.key === "Escape") {
      event.preventDefault();
      closeImage();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if viewer.image}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={viewer.image.name}
    tabindex="-1"
    onclick={closeImage}
    onkeydown={null}
  >
    <button
      class="close codicon codicon-close"
      type="button"
      aria-label="Close image"
      onclick={closeImage}
    ></button>
    <img
      src={viewer.image.src}
      alt={viewer.image.name}
      onclick={(event) => event.stopPropagation()}
    />
    <span class="name">{viewer.image.name}</span>
  </div>
{/if}

<style lang="scss">
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    background: rgb(0 0 0 / 0.75);
    cursor: zoom-out;
  }

  img {
    max-width: 100%;
    max-height: calc(100% - 32px);
    object-fit: contain;
    border-radius: var(--nova-radius);
    background: var(--nova-surface);
    cursor: default;
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    color: #fff;
    font-size: 0.9em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 6px;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.5);
    color: #fff;
    cursor: pointer;

    &:hover {
      background: rgb(0 0 0 / 0.8);
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
    }
  }
</style>
