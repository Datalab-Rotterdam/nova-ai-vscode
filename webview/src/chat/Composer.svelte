<script lang="ts">
  import type { ApprovalMode, ChatState } from "../../../src/panel/protocol";
  import {
    parseSlashCommand,
    suggestSlashCommands,
    type SlashCommand,
  } from "../../../src/panel/slashCommands";

  let {
    chat,
    post,
  }: { chat: ChatState; post: (message: Record<string, unknown>) => void } =
    $props();

  let text = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();
  let imageInput: HTMLInputElement | undefined = $state();
  let draggingImage = $state(false);
  let contextOpen = $state(false);
  let contextWrap: HTMLElement | undefined = $state();

  function toggleContext(open: boolean) {
    contextOpen = open;
  }

  // Close the context popover on outside click, or Escape.
  $effect(() => {
    if (!contextOpen) {
      return;
    }
    function onDown(event: Event) {
      if (contextWrap && !contextWrap.contains(event.target as Node)) {
        contextOpen = false;
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        contextOpen = false;
      }
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  const usagePercent = $derived(
    chat.usage
      ? Math.min(
          100,
          Math.round((chat.usage.used / Math.max(1, chat.usage.total)) * 100),
        )
      : 0,
  );
  const questionPending = $derived(
    chat.items.some(
      (item) => item.kind === "question" && item.status === "pending",
    ),
  );
  // Slash commands (/clear, /model, …) also work without a model.
  const canSend = $derived(
    Boolean(text.trim() || chat.attachments.length) &&
      (Boolean(chat.modelId) || Boolean(parseSlashCommand(text))),
  );

  /* Slash command menu: shown while the first word starts with "/"; Esc hides it until the text changes. */
  let highlighted = $state(0);
  let menuDismissed = $state(false);
  const suggestions = $derived(menuDismissed ? [] : suggestSlashCommands(text));

  const approvalLabels: Record<ApprovalMode, string> = {
    ask: "Ask every time",
    autoReadOnly: "Auto-run read-only",
    autoAll: "Auto-run all",
  };

  function send() {
    if (!canSend) {
      return;
    }
    post({ command: "chat/send", text });
    text = "";
    resize();
  }

  /** Fills in a suggested command; Enter runs it at once unless it needs an argument. */
  function pickCommand(command: SlashCommand, run: boolean) {
    if (run && !command.args?.startsWith("<")) {
      text = `/${command.name}`;
      send();
      return;
    }
    text = `/${command.name} `;
    textarea?.focus();
    resize();
  }

  function onInput() {
    highlighted = 0;
    menuDismissed = false;
    resize();
  }

  function onKeydown(event: KeyboardEvent) {
    if (suggestions.length && !event.isComposing) {
      const move =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (move) {
        event.preventDefault();
        highlighted =
          (highlighted + move + suggestions.length) % suggestions.length;
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        pickCommand(
          suggestions[Math.min(highlighted, suggestions.length - 1)],
          event.key === "Enter",
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        menuDismissed = true;
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function resize() {
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }

  /*
   * Images as context: pick one with the camera button, paste (Ctrl/Cmd+V), or drop a file
   * on the composer. The extension decides which models actually send them.
   */
  function addImageDataUrl(name: string, dataUrl: string) {
    post({ command: "chat/addImage", name, dataUrl });
  }

  function addImageFiles(files: File[]) {
    for (const file of files.filter((file) => file.type.startsWith("image/"))) {
      const reader = new FileReader();
      reader.onload = () => addImageDataUrl(file.name, String(reader.result));
      reader.readAsDataURL(file);
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.some((file) => file.type.startsWith("image/"))) {
      return;
    }
    event.preventDefault();
    addImageFiles(files);
  }

  let dragDepth = 0;
  function hasImage(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) {
      return false;
    }
    if (dataTransfer.types.includes("Files")) {
      return [...(dataTransfer.files ?? [])].some((file) =>
        file.type.startsWith("image/"),
      );
    }
    return (
      dataTransfer.types.includes("image/png") ||
      dataTransfer.types.includes("image/jpeg") ||
      dataTransfer.types.includes("image/webp")
    );
  }
  function onDragEnter(event: DragEvent) {
    if (hasImage(event.dataTransfer)) {
      dragDepth += 1;
      draggingImage = true;
    }
  }
  function onDragLeave(event: DragEvent) {
    if (hasImage(event.dataTransfer) && --dragDepth <= 0) {
      dragDepth = 0;
      draggingImage = false;
    }
  }
  function onDrop(event: DragEvent) {
    dragDepth = 0;
    draggingImage = false;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.some((file) => file.type.startsWith("image/"))) {
      return;
    }
    event.preventDefault();
    addImageFiles(files);
  }

  function onPickedImages(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    addImageFiles([...(input.files ?? [])]);
    input.value = "";
  }

  $effect(() => {
    textarea?.focus();
  });
</script>

<div class="composer-wrap" class:running={chat.running}>
  {#if chat.queue.length}
    <ul class="queue" aria-label="Waiting messages">
      {#each chat.queue as item (item.id)}
        <li>
          <button
            class="mode"
            class:steer={item.mode === "steer"}
            title={item.mode === "steer"
              ? "Steer: given to Nova at its next step. Click to send after the reply instead."
              : "Queued: sent after the current reply. Click to steer Nova now instead."}
            onclick={() =>
              post({
                command: "chat/queueMode",
                id: item.id,
                mode: item.mode === "steer" ? "queue" : "steer",
              })}
          >
            <span
              class={`codicon codicon-${item.mode === "steer" ? "arrow-small-right" : "clock"}`}
              aria-hidden="true"
            ></span>{item.mode === "steer" ? "Steer" : "Queued"}
          </button>
          <span class="queue-text" title={item.text}
            >{item.text || item.attachments.join(", ")}</span
          >
          {#if !chat.running || item.mode === "queue"}
            <button
              class="icon codicon codicon-play"
              title={chat.running ? "Steer now" : "Send now"}
              aria-label="Send now"
              onclick={() =>
                post({ command: "chat/queueSendNow", id: item.id })}
            ></button>
          {/if}
          <button
            class="icon codicon codicon-close"
            title="Remove"
            aria-label="Remove from queue"
            onclick={() => post({ command: "chat/queueRemove", id: item.id })}
          ></button>
        </li>
      {/each}
    </ul>
  {/if}
  <form
    class="composer"
    class:dragging={draggingImage}
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
    ondragenter={onDragEnter}
    ondragover={(event) => {
      if (hasImage(event.dataTransfer)) {
        event.preventDefault();
      }
    }}
    ondragleave={onDragLeave}
    ondrop={onDrop}
  >
    {#if suggestions.length}
      <ul
        class="slash-menu"
        id="nova-slash-menu"
        role="listbox"
        aria-label="Slash commands"
      >
        {#each suggestions as command, index (command.name)}
          <li
            id={`nova-slash-${command.name}`}
            role="option"
            aria-selected={index === highlighted}
            class:active={index === highlighted}
            onmousedown={(event) => {
              event.preventDefault();
              pickCommand(command, true);
            }}
            onmousemove={() => (highlighted = index)}
          >
            <span class="slash-name"
              >/{command.name}{#if command.args}<span class="slash-args">
                  {command.args}</span
                >{/if}</span
            >
            <span class="slash-description">{command.description}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if chat.attachments.length}
      <ul class="attachments">
        {#each chat.attachments as attachment (attachment.id)}
          <li>
            {#if attachment.image}
              <img
                class="chip-image"
                src={`data:${attachment.image.mimeType};base64,${attachment.image.data}`}
                alt=""
                title={attachment.label}
              />
            {:else}
              <span class="codicon codicon-file" aria-hidden="true"></span>
            {/if}
            <button
              class="chip-label"
              type="button"
              title={attachment.label}
              onclick={() =>
                attachment.path
                  ? post({ command: "chat/openFile", path: attachment.path })
                  : undefined}>{attachment.label}</button
            >
            <button
              class="chip-remove codicon codicon-close"
              type="button"
              aria-label={`Remove ${attachment.label}`}
              onclick={() =>
                post({ command: "chat/removeAttachment", id: attachment.id })}
            ></button>
          </li>
        {/each}
      </ul>
    {/if}

    <textarea
      bind:this={textarea}
      bind:value={text}
      oninput={onInput}
      onkeydown={onKeydown}
      onpaste={onPaste}
      rows="1"
      placeholder={!chat.models.length
        ? "No Nova models available"
        : questionPending
          ? "Answer Nova's question…"
          : chat.running
            ? "Steer Nova or queue a follow-up…"
            : "Ask Nova to explain, change or build something…"}
      aria-label="Message Nova"
      aria-autocomplete="list"
      aria-controls={suggestions.length ? "nova-slash-menu" : undefined}
      aria-activedescendant={suggestions[highlighted]
        ? `nova-slash-${suggestions[highlighted].name}`
        : undefined}></textarea>

    <input
      bind:this={imageInput}
      class="image-input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      aria-hidden="true"
      tabindex="-1"
      onchange={onPickedImages}
    />

    <div class="toolbar">
      <button
        class="icon codicon codicon-attach"
        type="button"
        title="Add files"
        aria-label="Add files"
        onclick={() => post({ command: "chat/addFile" })}
      ></button>
      <button
        class="icon codicon codicon-file-media"
        type="button"
        title="Add images (or paste, or drop them here)"
        aria-label="Add images"
        onclick={() => imageInput?.click()}
      ></button>
      <button
        class="icon codicon codicon-selection"
        type="button"
        title="Add editor selection"
        aria-label="Add editor selection"
        onclick={() => post({ command: "chat/addSelection" })}
      ></button>

      <select
        class="select"
        aria-label="Model"
        value={chat.modelId}
        onchange={(event) =>
          post({
            command: "chat/selectModel",
            modelId: event.currentTarget.value,
          })}
      >
        {#each chat.models as model (model.id)}
          <option value={model.id}>{model.name}</option>
        {/each}
      </select>

      <select
        class="select approvals"
        aria-label="Tool approvals"
        title="When to ask before running tools"
        value={chat.approvalMode}
        onchange={(event) =>
          post({
            command: "chat/setApprovalMode",
            mode: event.currentTarget.value,
          })}
      >
        {#each Object.entries(approvalLabels) as [mode, label] (mode)}
          <option value={mode}>{label}</option>
        {/each}
      </select>

      <span class="spacer"></span>

      {#if chat.usage}
        <div class="meter-wrap" bind:this={contextWrap}>
          <button
            class="meter"
            type="button"
            aria-label={`Context window, ${usagePercent}% used. Click for details and to compact.`}
            aria-expanded={contextOpen}
            onclick={() => toggleContext(!contextOpen)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" class="track"></circle>
              <circle
                cx="10"
                cy="10"
                r="8"
                class={`fill ${usagePercent >= 90 ? "high" : usagePercent >= 70 ? "mid" : ""}`}
                stroke-dasharray={`${(usagePercent / 100) * 50.27} 50.27`}
              ></circle>
            </svg>
          </button>
          {#if contextOpen}
            <div class="context-pop" role="dialog" aria-label="Context window">
              <div class="cp-head">
                <span>Context window</span>
                <span class="cp-pct">{usagePercent}%</span>
              </div>
              <div class="cp-bar" aria-hidden="true">
                <div
                  class="cp-fill"
                  class:high={usagePercent >= 90}
                  class:mid={usagePercent >= 70 && usagePercent < 90}
                  style="width: {Math.min(100, usagePercent)}%"
                ></div>
              </div>
              <p class="cp-text">
                {chat.usage.used.toLocaleString()} / {chat.usage.total.toLocaleString()}
                tokens
              </p>
              <button
                class="cp-compact"
                type="button"
                disabled={chat.running}
                onclick={() => {
                  contextOpen = false;
                  post({ command: "chat/compact" });
                }}
              >
                <span class="codicon codicon-merge" aria-hidden="true"></span>
                {chat.running ? "Nova is working…" : "Compact now"}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if chat.running}
        <button
          class="send stop"
          type="button"
          title="Stop"
          aria-label="Stop"
          onclick={() => post({ command: "chat/stop" })}
        >
          <span class="stop-square" aria-hidden="true"></span>
        </button>
        {#if canSend}
          <button
            class="send"
            type="submit"
            title="Steer Nova (Enter)"
            aria-label="Steer Nova"
          >
            <span class="codicon codicon-send" aria-hidden="true"></span>
          </button>
        {/if}
      {:else}
        <button
          class="send"
          type="submit"
          title="Send (Enter)"
          aria-label="Send"
          disabled={!canSend}
        >
          <span class="codicon codicon-send" aria-hidden="true"></span>
        </button>
      {/if}
    </div>
  </form>
</div>

<style lang="scss">
  /*
   * Same effect as the Nova platform chat bar: while generating, a soft primary-colored
   * radial glow (::before) and a slowly orbiting conic gradient (::after) fade in behind
   * the composer. Isolation keeps both above the panel background but below the composer.
   */
  .composer-wrap {
    --nova-glow-angle: 0deg;
    position: relative;
    isolation: isolate;
    flex: none;
    margin: 4px 10px 12px;
    animation: nova-chatbar-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;

    &::before,
    &::after {
      content: "";
      position: absolute;
      /* Centered on the composer: the sidebar has no room below it for the platform's lower glow. */
      top: 55%;
      left: 50%;
      width: calc(100% + 0.5rem);
      height: calc(100% + 1.75rem);
      border-radius: 999px;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.9);
      transition:
        opacity 0.42s,
        transform 0.42s,
        filter 0.42s;
    }

    &::before {
      z-index: -2;
      background: radial-gradient(
        ellipse at center,
        color-mix(in srgb, var(--nova-brand-primary) 26%, transparent) 0 26%,
        transparent 54%
      );
      filter: blur(28px);
    }

    &::after {
      z-index: -1;
      background: conic-gradient(
        from var(--nova-glow-angle),
        color-mix(in srgb, var(--nova-brand-primary) 0%, transparent) 0deg,
        color-mix(in srgb, var(--nova-brand-primary) 72%, transparent) 55deg,
        color-mix(in srgb, var(--nova-brand-info) 52%, transparent) 145deg,
        color-mix(in srgb, var(--nova-brand-secondary) 40%, transparent) 220deg,
        color-mix(in srgb, var(--nova-brand-primary) 72%, transparent) 300deg,
        color-mix(in srgb, var(--nova-brand-primary) 0%, transparent) 360deg
      );
      filter: blur(30px);
      animation: nova-orbit 5s linear infinite paused;
    }

    &.running::before {
      opacity: 0.92;
      filter: blur(22px);
      transform: translate(-50%, -50%) scale(1);
    }

    &.running::after {
      opacity: 1;
      filter: blur(22px);
      animation-play-state: running;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  .composer {
    position: relative;
    display: grid;
    gap: 4px;
    padding: 6px 6px 6px 8px;
    border: 1px solid var(--nova-input-border);
    border-radius: 14px;
    background: var(--nova-input-bg);
    transition:
      border-color 0.2s ease,
      box-shadow 0.3s ease;

    &:focus-within {
      border-color: var(--nova-focus);
    }
  }

  .running .composer {
    box-shadow: 0 2px 12px -6px color-mix(in srgb, var(--nova-brand-primary) 40%, transparent);
  }

  /* An image is being dragged over the composer. */
  .composer.dragging {
    border-color: var(--nova-focus);
    outline: 1px dashed var(--nova-focus);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-wrap {
      animation: none;

      &::after {
        animation: none;
      }
    }
  }

  /* High contrast: no glow, a clear dashed border instead. */
  :global(body.vscode-high-contrast) .composer-wrap::before,
  :global(body.vscode-high-contrast) .composer-wrap::after,
  :global(body.vscode-high-contrast-light) .composer-wrap::before,
  :global(body.vscode-high-contrast-light) .composer-wrap::after {
    display: none;
  }

  :global(body.vscode-high-contrast) .running .composer,
  :global(body.vscode-high-contrast-light) .running .composer {
    border: 1px dashed var(--vscode-contrastActiveBorder, var(--nova-focus));
    box-shadow: none;
  }

  /* Opens upwards over the conversation, aligned with the composer. */
  .slash-menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 2;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 10px;
    background: var(--vscode-editorWidget-background, var(--nova-input-bg));
    box-shadow: 0 4px 16px -6px var(--vscode-widget-shadow, transparent);
    list-style: none;

    li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      padding: 3px 6px;
      border-radius: var(--nova-radius);
      cursor: pointer;

      &.active {
        background: var(
          --vscode-list-activeSelectionBackground,
          var(--nova-hover)
        );
        color: var(--vscode-list-activeSelectionForeground, var(--nova-fg));

        .slash-description,
        .slash-args {
          color: inherit;
        }
      }
    }
  }

  .slash-name {
    flex: none;
    font-family: var(--nova-mono);
  }

  .slash-args,
  .slash-description {
    color: var(--nova-muted);
  }

  .slash-description {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue {
    display: grid;
    gap: 2px;
    margin: 0 0 6px;
    padding: 4px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 10px;
    background: var(--nova-bg);
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 1px 2px;
    }
  }

  .mode {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
    padding: 0 6px 0 3px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 999px;
    background: none;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;

    &.steer {
      border-color: color-mix(
        in srgb,
        var(--nova-brand-primary) 50%,
        transparent
      );
      color: var(--nova-fg);
    }

    .codicon {
      font-size: 14px;
    }
  }

  .queue-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--nova-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  textarea {
    width: 100%;
    min-height: 36px;
    max-height: 240px;
    resize: none;
    padding: 2px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--nova-input-fg);
    font: inherit;

    &::placeholder {
      color: var(--nova-input-placeholder);
    }
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      max-width: 100%;
      padding: 1px 2px 1px 5px;
      border: 1px solid var(--nova-subtle-border);
      border-radius: var(--nova-radius);
      font-size: 0.9em;
    }
  }

  .chip-image {
    flex: none;
    width: 22px;
    height: 22px;
    object-fit: cover;
    border-radius: 3px;
  }

  /* The image picker is invisible; the camera button opens it. */
  .image-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  .chip-label,
  .chip-remove {
    padding: 0;
    border: 0;
    background: none;
    color: var(--nova-fg);
    cursor: pointer;
  }

  .chip-label {
    font: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-remove {
    color: var(--nova-muted);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .spacer {
    flex: 1;
  }

  .icon {
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--nova-fg);
    }
  }

  /* Size each dropdown to its selected option, not its longest one. */
  .select {
    field-sizing: content;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    padding: 1px 2px;
    border: 1px solid transparent;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.9em;
    text-overflow: ellipsis;
    cursor: pointer;

    &:hover {
      color: var(--nova-fg);
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }

    option {
      background: var(--vscode-dropdown-background, var(--nova-input-bg));
      color: var(--vscode-dropdown-foreground, var(--nova-fg));
    }
  }

  /* Context window: a ring that opens a popover on click (not a hover tooltip). */
  .context-wrap,
  .meter-wrap {
    position: relative;
  }

  .meter {
    display: grid;
    place-items: center;
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
    }

    &[aria-expanded="true"] {
      background: var(--nova-hover);
    }
  }

  .meter svg {
    display: block;
    width: 16px;
    height: 16px;
    margin: 0 4px;
    transform: rotate(-90deg);

    circle {
      fill: none;
      stroke-width: 3;
    }

    .track {
      stroke: var(--nova-subtle-border);
    }

    .fill {
      stroke: var(--nova-muted);

      &.mid {
        stroke: var(--nova-warning);
      }

      &.high {
        stroke: var(--nova-error);
      }
    }
  }

  .context-pop {
    position: absolute;
    bottom: calc(100% + 8px);
    right: -4px;
    width: 232px;
    padding: 10px 12px;
    border: 1px solid var(--nova-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);
    box-shadow: 0 4px 18px rgb(0 0 0 / 25%);
    z-index: 40;

    .cp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.9em;
      font-weight: 600;
    }

    .cp-pct {
      color: var(--nova-muted);
      font-weight: 400;
    }

    .cp-bar {
      height: 5px;
      margin-top: 8px;
      border-radius: 999px;
      background: var(--nova-subtle-border);
      overflow: hidden;
    }

    .cp-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--nova-muted);

      &.mid {
        background: var(--nova-warning);
      }

      &.high {
        background: var(--nova-error);
      }
    }

    .cp-text {
      margin: 6px 0 10px;
      font-size: 0.85em;
      color: var(--nova-muted);
    }

    .cp-compact {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 5px 8px;
      border: 1px solid var(--nova-button-border, var(--nova-border));
      border-radius: var(--nova-radius);
      background: var(--vscode-button-background, var(--nova-surface));
      color: var(--vscode-button-foreground, var(--nova-fg));
      font: inherit;
      font-size: 0.85em;
      cursor: pointer;

      &:hover:not(:disabled) {
        opacity: 0.9;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  /* Same footprint as the other toolbar icons; the accent color only shows when there is something to send. */
  .send {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    padding: 0;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:not(:disabled) {
      color: var(--vscode-textLink-foreground, var(--nova-focus));
    }

    &:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &.stop {
      color: var(--nova-brand-red);

      &:hover {
        background: color-mix(in srgb, var(--nova-brand-red) 15%, transparent);
      }
    }
  }

  .stop-square {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: currentColor;
  }
</style>
