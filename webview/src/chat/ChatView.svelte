<script lang="ts">
  import { setContext, tick } from "svelte";
  import type { ChatState } from "../../../src/panel/protocol";
  import type { ProfileView } from "../../../src/core/types";
  import Avatar from "./Avatar.svelte";
  import ChangesStrip from "./ChangesStrip.svelte";
  import ChatsPage from "./ChatsPage.svelte";
  import Composer from "./Composer.svelte";
  import ImageViewer from "./ImageViewer.svelte";
  import { openImage } from "./viewer.svelte";
  import QuestionCard from "./QuestionCard.svelte";
  import { fileIcon } from "./fileIcon";
  import TodoStrip from "./TodoStrip.svelte";
  import SubagentStrip from "./SubagentStrip.svelte";
  import Markdown from "./Markdown.svelte";
  import StepGroup from "./StepGroup.svelte";
  import ToolCard from "./ToolCard.svelte";
  import {
    groupItems,
    isStepActive,
    thoughtFor,
    visibleChatItems,
  } from "../../../src/panel/steps";

  let {
    chat,
    post,
    onAccount,
    logoUri,
    surface = "sidebar",
    profile,
    chatsOpen = false,
    onChats,
  }: {
    chat: ChatState;
    profile?: ProfileView;
    logoUri?: string;
    surface?: "sidebar" | "editor";
    post: (message: Record<string, unknown>) => void;
    onAccount: () => void;
    /** The Chats page is shown over the conversation. */
    chatsOpen?: boolean;
    onChats: (open: boolean) => void;
  } = $props();

  let list: HTMLElement | undefined = $state();
  let content: HTMLElement | undefined = $state();

  /*
   * Scroll lock: while locked the view follows new output. Any upward scroll by the user
   * releases it immediately; scrolling back to the bottom locks it again. Sending a message
   * or opening another chat always jumps to the bottom and locks.
   */
  let locked = $state(true);
  const BOTTOM_THRESHOLD = 24;

  function isAtBottom(): boolean {
    return (
      !list ||
      list.scrollHeight - list.scrollTop - list.clientHeight <= BOTTOM_THRESHOLD
    );
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    list?.scrollTo({ top: list.scrollHeight, behavior });
  }

  function jumpToLatest() {
    locked = true;
    scrollToBottom("smooth");
  }

  /*
   * Only real user input releases the lock. Scroll events cannot tell our own scrolls
   * from the user's (and arrive a frame late, after more text streamed in), so they are
   * only used to re-lock once the user is back at the bottom.
   */
  let draggingScrollbar = false;

  function onScroll() {
    if (isAtBottom()) {
      locked = true;
    } else if (draggingScrollbar) {
      locked = false;
    }
  }

  function onWheel(event: WheelEvent) {
    if (event.deltaY < 0) {
      locked = false;
    }
  }

  let touchY = 0;
  function onTouchStart(event: TouchEvent) {
    touchY = event.touches[0]?.clientY ?? 0;
  }

  function onTouchMove(event: TouchEvent) {
    // Finger moving down scrolls the content up.
    if ((event.touches[0]?.clientY ?? 0) > touchY) {
      locked = false;
    }
  }

  /** Text selected in the conversation (not in a field, which copies natively). */
  function selectedText(target: EventTarget | null): string {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return "";
    }
    return window.getSelection()?.toString() ?? "";
  }

  // Selected messages go to the clipboard. The webview does not always pass Ctrl/Cmd+C on to
  // the browser's own copy, so write the selection ourselves.
  function onWindowKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
      const selected = selectedText(event.target);
      if (selected) {
        void navigator.clipboard?.writeText(selected).catch(() => undefined);
      }
    }
  }

  function onWindowCopy(event: ClipboardEvent) {
    const selected = selectedText(event.target);
    if (selected && event.clipboardData) {
      event.clipboardData.setData("text/plain", selected);
      event.preventDefault();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
      locked = false;
    }
  }

  function onPointerDown(event: PointerEvent) {
    // A press on the scrollbar (right of the content box) starts a drag.
    draggingScrollbar = Boolean(list && event.offsetX > list.clientWidth);
  }

  function onPointerUp() {
    draggingScrollbar = false;
  }

  // Listen for user scroll intent on the message list.
  $effect(() => {
    const element = list;
    if (!element) {
      return;
    }
    const listeners: Array<[string, EventListener]> = [
      ["scroll", onScroll as EventListener],
      ["wheel", onWheel as EventListener],
      ["touchstart", onTouchStart as EventListener],
      ["touchmove", onTouchMove as EventListener],
      ["keydown", onKeydown as EventListener],
      ["pointerdown", onPointerDown as EventListener],
    ];
    for (const [type, listener] of listeners) {
      element.addEventListener(type, listener, { passive: true });
    }
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      for (const [type, listener] of listeners) {
        element.removeEventListener(type, listener);
      }
      window.removeEventListener("pointerup", onPointerUp);
    };
  });

  // Follow content growth (streamed text, tool cards, expanding markdown) while locked.
  $effect(() => {
    if (!content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (locked) {
        scrollToBottom();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  });

  // A new user message or another chat: jump to the bottom and lock.
  let lastUserCount = 0;
  let lastSessionId = "";
  $effect(() => {
    const userCount = chat.items.filter((item) => item.kind === "user").length;
    if (userCount > lastUserCount || chat.sessionId !== lastSessionId) {
      locked = true;
      void tick().then(() => scrollToBottom());
    }
    lastUserCount = userCount;
    lastSessionId = chat.sessionId;
  });

  let editingId = $state<string | undefined>();
  let editText = $state("");

  function startEdit(itemId: string, text: string) {
    editingId = itemId;
    editText = text;
  }

  function submitEdit(itemId: string) {
    if (!editText.trim()) {
      return;
    }
    post({ command: "chat/editMessage", itemId, text: editText });
    editingId = undefined;
  }

  /** The conversation as it reads now: only the current answer version, steps folded. */
  const scoped = $derived(
    // A sub-agent's own tool calls show inside the agent (see SubagentList), not in the chat.
    visibleChatItems(chat.items).filter((item) => !(item.kind === "tool" && item.agentId)),
  );
  /** The agents of the latest answer; earlier ones stay on the spawn_agents card. */
  const latestAgents = $derived.by(() => {
    const lastUser = chat.items.findLast((item) => item.kind === "user");
    return (chat.subagents ?? []).filter((agent) => agent.runId === lastUser?.id);
  });
  setContext("nova.subagents", () => chat.subagents ?? []);
  const entries = $derived(groupItems(scoped));
  const lastUserIndex = $derived(
    scoped.findLastIndex((item) => item.kind === "user"),
  );

  /** No later question follows this message's answer (versions of it do not count). */
  function isLastQuestion(user: {
    id: string;
    branch?: { hostId: string };
  }): boolean {
    const host = user.branch?.hostId ?? user.id;
    const start = chat.items.findIndex(
      (item) =>
        item.kind === "user" && (item.id === host || item.branch?.hostId === host),
    );
    return !chat.items.some(
      (item, index) =>
        index > start &&
        item.kind === "user" &&
        item.id !== host &&
        item.branch?.hostId !== host,
    );
  }

  /** Copies a message and flashes the button's icon as a check. */
  function copyText(text: string, event: MouseEvent) {
    void navigator.clipboard?.writeText(text);
    const icon = event.currentTarget as HTMLElement;
    icon.classList.replace("codicon-copy", "codicon-check");
    setTimeout(() => icon.classList.replace("codicon-check", "codicon-copy"), 1200);
  }

  /** The versions of the answer of `item`: it, its host and its branches, in order. */
  function versionsOf(user: {
    kind: "user";
    id: string;
    branch?: { hostId: string; current: boolean };
    model?: string;
  }): Array<{ id: string; model?: string; current: boolean }> {
    if (!user.branch) {
      return [];
    }
    const host = user.branch.hostId;
    return chat.items
      .filter(
        (item) =>
          item.kind === "user" &&
          (item.id === host || item.branch?.hostId === host),
      )
      .map((item) => ({
        id: (item as { id: string }).id,
        model: (item as { model?: string }).model,
        current: (item as { branch?: { current: boolean } }).branch
          ? (item as { branch: { current: boolean } }).branch.current
          : false,
      }));
  }

  /** The model that answered the prompt before `index` (of the visible items; older chats: "Nova"). */
  function replyModel(index: number): string {
    for (let at = Math.min(index, scoped.length - 1); at >= 0; at--) {
      const item = scoped[at];
      if (item.kind === "user") {
        return item.model ?? "Nova";
      }
    }
    return "Nova";
  }

  /** A reply header goes above the first non-user item after each user message. */
  function startsReply(index: number): boolean {
    const item = scoped[index];
    return (
      item.kind !== "user" && (index === 0 || scoped[index - 1].kind === "user")
    );
  }
</script>

<svelte:window onkeydown={onWindowKeydown} oncopy={onWindowCopy} />

<section class="chat" class:editor={surface === "editor"}>
  <header>
    {#if chatsOpen}
      <span class="title">Chats</span>
    {:else}
      <span class="title" title={chat.title}>{chat.title}</span>
    {/if}
    <!-- The sidebar has these actions in VS Code's own title bar; the editor tab has none. -->
    {#if surface === "editor"}
      <button
        class="icon codicon codicon-history"
        title="Chats"
        aria-label="Chats"
        aria-pressed={chatsOpen}
        onclick={() => onChats(!chatsOpen)}
      ></button>
      <button
        class="icon codicon codicon-add"
        title="New chat in a new tab"
        aria-label="New chat in a new tab"
        onclick={() => post({ command: "newChatTab" })}
      ></button>
    {:else if chatsOpen}
      <button
        class="icon codicon codicon-close"
        title="Back to the chat (Esc)"
        aria-label="Back to the chat"
        onclick={() => onChats(false)}
      ></button>
    {/if}
    <button
      class="avatar-button"
      title="Account and models"
      aria-label="Account and models"
      onclick={onAccount}
    >
      <Avatar {profile} />
    </button>
  </header>

  <div class="body">
    <div class="conversation" inert={chatsOpen}>
      <div class="items-wrap">
        <div class="items" bind:this={list} role="log" aria-live="polite">
          <div class="content" bind:this={content}>
            {#if !scoped.length}
              <div class="empty">
                <span class="codicon codicon-sparkle" aria-hidden="true"></span>
                <p>
                  Ask Nova about your code, or let it make changes. Nova reads
                  files and searches on its own; it asks before editing files or
                  running commands.
                </p>
              </div>
            {/if}

            {#each entries as entry (entry.kind === "group" ? entry.id : entry.item.id)}
              {@const at = entry.kind === "group" ? entry.first : entry.index}
              {@const item =
                entry.kind === "group"
                  ? entry.steps[entry.steps.length - 1]
                  : entry.item}
              {#if entry.kind === "group" ? startsReply(entry.first) : startsReply(entry.index)}
                <div class="reply-header">
                  {#if logoUri}
                    <span
                      class="nova-mark reply-mark"
                      style:--mark-url={`url("${logoUri}")`}
                      aria-hidden="true"
                    ></span>
                  {:else}
                    <span class="codicon codicon-sparkle" aria-hidden="true"
                    ></span>
                  {/if}
                  <span class="reply-model">{replyModel(at)}</span>
                  {#if chat.running && at > lastUserIndex}
                    <span class="live-dot" aria-label="Generating"></span>
                  {/if}
                </div>
              {/if}
              {#if entry.kind === "group"}
                <!-- A group spins only while one of its steps is active (e.g. a background task). -->
                <StepGroup
                  group={entry}
                  running={chat.running && entry.steps.some(isStepActive)}
                  {post}
                />
              {:else if item.kind === "user"}
                {#if editingId === item.id}
                  <form
                    class="user editing"
                    onsubmit={(event) => {
                      event.preventDefault();
                      submitEdit(item.id);
                    }}
                  >
                    <!-- svelte-ignore a11y_autofocus -->
                    <textarea
                      bind:value={editText}
                      autofocus
                      rows="3"
                      aria-label="Edit message"
                      onkeydown={(event) => {
                        if (event.key === "Escape") {
                          editingId = undefined;
                        } else if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.isComposing
                        ) {
                          event.preventDefault();
                          submitEdit(item.id);
                        }
                      }}></textarea>
                    <div class="edit-actions">
                      <span class="edit-hint"
                        >{isLastQuestion(item)
                          ? "The edit becomes a new answer version"
                          : "Later messages will be replaced"}{chat.running
                          ? " and the current reply stopped"
                          : ""}.</span
                      >
                      <button
                        class="nova-button secondary"
                        type="button"
                        onclick={() => (editingId = undefined)}>Cancel</button
                      >
                      <button
                        class="nova-button"
                        type="submit"
                        disabled={!editText.trim()}>Send</button
                      >
                    </div>
                  </form>
                {:else}
                  {@const versions = item.branch ? versionsOf(item) : []}
                  {@const versionPos =
                    versions.findIndex(
                      (version: { id: string }) => version.id === item.id,
                    ) + 1}
                  <div class="user" class:steered={item.steered}>
                    <div class="user-actions">
                      <button
                        class="edit-button codicon codicon-copy"
                        title="Copy message"
                        aria-label="Copy message"
                        onclick={(event) => copyText(item.text, event)}
                      ></button>
                      <button
                        class="edit-button codicon codicon-edit"
                        title="Edit and resend"
                        aria-label="Edit and resend"
                        onclick={() => startEdit(item.id, item.text)}
                      ></button>
                      <button
                        class="edit-button codicon codicon-refresh"
                        title="Regenerate the answer"
                        aria-label="Regenerate the answer"
                        onclick={() =>
                          post({ command: "chat/regenerate", itemId: item.id })}
                      ></button>
                    </div>
                    {#if versions.length > 1}
                      <div class="versions" aria-label="Answer versions">
                        {#each versions as version, at (version.id)}
                          <button
                            class="version"
                            class:current={version.current}
                            title="Answer {at + 1}{version.model
                              ? ` (${version.model})`
                              : ''}"
                            aria-label={`Switch to answer ${at + 1}`}
                            aria-current={version.current ? "true" : undefined}
                            onclick={() =>
                              post({
                                command: "chat/branch",
                                itemId: version.id,
                                mode: "switch",
                              })}
                          >
                            {at + 1}
                          </button>
                        {/each}
                        <button
                          class="version accept"
                          title="Keep this answer and discard the others"
                          aria-label="Keep this answer"
                          onclick={() =>
                            post({
                              command: "chat/branch",
                              itemId: item.id,
                              mode: "accept",
                            })}
                        >
                          <span class="codicon codicon-check" aria-hidden="true"
                          ></span>
                        </button>
                        {#if item.branch}
                          <button
                            class="version discard"
                            title="Discard this answer"
                            aria-label="Discard this answer"
                            onclick={() =>
                              post({
                                command: "chat/branch",
                                itemId: item.id,
                                mode: "discard",
                              })}
                          >
                            <span
                              class="codicon codicon-close"
                              aria-hidden="true"
                            ></span>
                          </button>
                        {/if}
                      </div>
                    {/if}
                    {#if versionPos > 1}
                      <span class="version-label">Answer {versionPos}</span>
                    {/if}
                    {#if item.steered}<span class="steered-label"
                        ><span
                          class="codicon codicon-arrow-small-right"
                          aria-hidden="true"
                        ></span>Steered</span
                      >{/if}
                    {#if item.files?.length || item.attachments.length}
                      <div class="user-attachments">
                        {#each item.files ?? item.attachments.map( (label) => ({ id: label, label }), ) as file (file.id)}
                          {#if file.image}
                            {@const src = `data:${file.image.mimeType};base64,${file.image.data}`}
                            <button
                              class="sent-image"
                              type="button"
                              title={file.label}
                              aria-label={`View ${file.label}`}
                              onclick={() => openImage(src, file.label)}
                            >
                              <img {src} alt={file.label} />
                            </button>
                          {:else}
                            <span
                              ><span
                                class={`codicon codicon-${fileIcon(file.label).icon} file-icon ${fileIcon(file.label).tone}`}
                                aria-hidden="true"
                              ></span>{file.label}</span
                            >
                          {/if}
                        {/each}
                      </div>
                    {/if}
                    {#if item.text}<p>{item.text}</p>{/if}
                  </div>
                {/if}
              {:else if item.kind === "assistant"}
                <div class="assistant">
                  {#if item.text && !(chat.running && at === scoped.length - 1)}
                    <div class="message-actions">
                      <button
                        class="edit-button codicon codicon-copy"
                        title="Copy answer"
                        aria-label="Copy answer"
                        onclick={(event) => copyText(item.text, event)}
                      ></button>
                    </div>
                  {/if}
                  <Markdown
                    text={item.text}
                    onLink={(href, text) =>
                      post({ command: "chat/openLink", href, text })}
                    onTable={(format, rows) =>
                      post({ command: "chat/exportTable", format, rows })}
                    onCode={(code, language) =>
                      post({ command: "chat/openSnippet", code, language })}
                  />
                </div>
              {:else if item.kind === "thinking"}
                <details class="thinking">
                  <summary
                    ><span class="codicon codicon-lightbulb" aria-hidden="true"
                    ></span>{chat.running
                      ? "Thinking"
                      : thoughtFor(item.durationMs ?? null)}</summary
                  >
                  <p>{item.text}</p>
                </details>
              {:else if item.kind === "tool"}
                <ToolCard {item} {post} />
              {:else if item.kind === "question"}
                <QuestionCard {item} {post} />
              {:else}
                <p class={`notice ${item.tone}`}>
                  <span
                    class={`codicon codicon-${item.tone === "error" ? "error" : item.tone === "warning" ? "warning" : "info"}`}
                    aria-hidden="true"
                  ></span><span class="notice-text">{item.text}</span>
                </p>
              {/if}
            {/each}

            {#if chat.running}
              {#if lastUserIndex === scoped.length - 1}
                <div class="reply-header">
                  {#if logoUri}
                    <span
                      class="nova-mark reply-mark"
                      style:--mark-url={`url("${logoUri}")`}
                      aria-hidden="true"
                    ></span>
                  {/if}
                  <span class="reply-model"
                    >{replyModel(scoped.length - 1)}</span
                  >
                  <span class="live-dot" aria-label="Generating"></span>
                </div>
              {/if}
              <div class="working" aria-label="Nova is working">
                <span class="shimmer">{chat.effort === "none" ? "Working…" : "Thinking…"}</span>
              </div>
            {/if}
          </div>
        </div>
        {#if !locked}
          <button
            class="jump"
            onclick={jumpToLatest}
            title="Jump to latest"
            aria-label="Jump to latest"
          >
            <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
          </button>
        {/if}
      </div>

      {#if chat.changes?.length}
        <ChangesStrip changes={chat.changes} {post} />
      {/if}
      {#if latestAgents.length}
        <SubagentStrip agents={latestAgents} items={chat.items} {post} />
      {/if}
      {#if chat.todos?.length}
        <TodoStrip todos={chat.todos} running={chat.running} {post} />
      {/if}
      <Composer {chat} {post} />
    </div>
    {#if chatsOpen}
      <ChatsPage
        sessions={chat.sessions}
        openElsewhere={chat.openElsewhere ?? []}
        currentId={chat.sessionId}
        running={chat.running}
        {surface}
        {post}
        onClose={() => onChats(false)}
      />
    {/if}
  </div>
<ImageViewer />
</section>

<style lang="scss">
  .chat {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px 4px 12px;
    border-bottom: 1px solid var(--nova-border);
  }

  .title {
    flex: 1;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-fg);
    cursor: pointer;

    &:hover,
    &[aria-pressed="true"] {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }
  }

  .avatar-button {
    display: grid;
    place-items: center;
    margin-left: 4px;
    padding: 2px;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
    }
  }

  /* The Chats page lies over the conversation, which stays mounted (scroll position, streaming). */
  .body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .conversation {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .items-wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }

  .items {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  .content {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .jump {
    position: absolute;
    left: 50%;
    bottom: 8px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 50%;
    background: var(--vscode-editorWidget-background, var(--nova-input-bg));
    color: var(--nova-fg);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.25));
    transform: translateX(-50%);
    cursor: pointer;
    animation: nova-chatbar-enter 0.25s ease both;

    &:hover {
      background: var(--nova-hover);
    }
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    margin: auto 0;
    padding: 24px 8px;
    color: var(--nova-muted);
    text-align: center;

    .codicon {
      font-size: 24px;
    }
  }

  .user {
    align-self: flex-end;
    max-width: 90%;
    margin-bottom: 6px;
    padding: 6px 10px;
    border-radius: var(--nova-radius-large);
    background: var(--vscode-chat-requestBackground, var(--nova-surface));
    border: 1px solid
      var(--vscode-chat-requestBorder, var(--nova-subtle-border));

    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }

  .user {
    position: relative;
  }

  .edit-button {
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    font-size: 14px;
    cursor: pointer;

    &:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--nova-hover));
      color: var(--nova-fg);
    }
  }

  .user.editing {
    align-self: stretch;
    max-width: none;
    display: grid;
    gap: 6px;

    textarea {
      width: 100%;
      resize: vertical;
      min-height: 52px;
      padding: 2px;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--nova-fg);
      font: inherit;
    }
  }

  .edit-actions {
    display: flex;
    align-items: center;
    gap: 6px;

    .nova-button {
      width: auto;
      padding: 2px 10px;
    }
  }

  .edit-hint {
    flex: 1;
    color: var(--nova-muted);
    font-size: 0.85em;
  }

  .steered-label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 2px;
    color: var(--nova-muted);
    font-size: 0.85em;
  }

  /* A small toolbar on the message's edge, shown while it is hovered or focused: top-right on a
     question, bottom-right under an answer. */
  .user-actions,
  .message-actions {
    position: absolute;
    top: -12px;
    right: 8px;
    z-index: 1;
    display: flex;
    gap: 1px;
    padding: 1px 2px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: var(--vscode-editorWidget-background, var(--nova-bg));
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }

  .user:hover .user-actions,
  .user:focus-within .user-actions,
  .assistant:hover .message-actions,
  .assistant:focus-within .message-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .assistant {
    position: relative;
    margin-bottom: 10px;
  }

  .message-actions {
    top: auto;
    bottom: -12px;
    right: 0;
  }

  .versions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 2px;

    .version {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border: 1px solid var(--nova-subtle-border);
      border-radius: 999px;
      background: none;
      color: var(--nova-muted);
      font: inherit;
      font-size: 0.75em;
      line-height: 1;
      cursor: pointer;

      &:hover {
        color: var(--nova-fg);
        background: var(--nova-hover);
      }

      &.current {
        border-color: var(--nova-focus);
        color: var(--nova-fg);
        background: color-mix(in srgb, var(--nova-focus) 12%, transparent);
      }

      .codicon {
        font-size: 11px;
      }

      &.accept {
        border-style: dashed;
      }
    }
  }

  .version-label {
    margin-right: 4px;
    color: var(--nova-muted);
    font-size: 0.8em;
  }

  /* Editor tab: center the conversation in a readable column, like the Nova platform. */
  .chat.editor {
    .content {
      max-width: 860px;
      margin: 0 auto;
      padding: 20px 24px;
    }

    :global(.composer-wrap) {
      width: calc(100% - 48px);
      max-width: 860px;
      margin: 4px auto 16px;
    }

    :global(.todos),
    :global(.changes),
    :global(.subagents) {
      width: calc(100% - 48px);
      max-width: 860px;
      margin: 0 auto 6px;
    }
  }

  .user-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
    color: var(--nova-muted);
    font-size: 0.9em;

    .sent-image {
      display: block;
      padding: 0;
      border: 1px solid var(--nova-subtle-border);
      border-radius: var(--nova-radius);
      overflow: hidden;
      background: none;
      cursor: zoom-in;

      &:focus-visible {
        outline: 1px solid var(--nova-focus);
      }

      img {
        display: block;
        max-width: 160px;
        max-height: 120px;
        object-fit: cover;
      }
    }

    span {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
  }

  .thinking {
    color: var(--nova-muted);

    summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    p {
      margin-top: 4px;
      padding-left: 10px;
      border-left: 2px solid var(--nova-subtle-border);
      white-space: pre-wrap;
      font-size: 0.92em;
    }
  }

  .notice {
    display: flex;
    gap: 6px;
    color: var(--nova-muted);
    font-size: 0.92em;

    /* /help and /model list one entry per line. */
    .notice-text {
      white-space: pre-line;
    }

    &.error .codicon {
      color: var(--nova-error);
    }

    &.warning .codicon {
      color: var(--nova-warning);
    }
  }

  .reply-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -4px;
    font-weight: 600;
  }

  .reply-mark {
    width: 16px;
    height: 16px;
    color: var(--nova-fg);
  }

  .reply-model {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--nova-brand-primary);
    box-shadow: 0 0 0 0
      color-mix(in srgb, var(--nova-brand-primary) 60%, transparent);
    animation: nova-pulse 1.6s ease-in-out infinite;
  }

  .working {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--nova-muted);
  }

  /* Text shimmer: a highlight sweeping through the label. */
  .shimmer {
    background: linear-gradient(
      90deg,
      var(--nova-muted) 0%,
      var(--nova-muted) 40%,
      var(--nova-fg) 50%,
      var(--nova-muted) 60%,
      var(--nova-muted) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: nova-shimmer 1.8s linear infinite;
  }

  @keyframes nova-pulse {
    0%,
    100% {
      opacity: 0.6;
      box-shadow: 0 0 0 0
        color-mix(in srgb, var(--nova-brand-primary) 50%, transparent);
    }
    50% {
      opacity: 1;
      box-shadow: 0 0 0 4px
        color-mix(in srgb, var(--nova-brand-primary) 0%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      color: var(--nova-muted);
      background: none;
    }
  }
</style>
