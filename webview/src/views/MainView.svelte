<script lang="ts">
  import { tick } from 'svelte';
  import arrowClockwiseIcon from 'bootstrap-icons/icons/arrow-clockwise.svg?raw';
  import arrowLeftIcon from 'bootstrap-icons/icons/arrow-left.svg?raw';
  import boxArrowRightIcon from 'bootstrap-icons/icons/box-arrow-right.svg?raw';
  import gearIcon from 'bootstrap-icons/icons/gear.svg?raw';
  import plusLgIcon from 'bootstrap-icons/icons/plus-lg.svg?raw';
  import {
    COMMAND_OPEN_SETTINGS,
    COMMAND_REFRESH_MODELS,
    COMMAND_SIGN_OUT
  } from '../../../src/core/constants';
  import ChatComposer from '../components/composer/ChatComposer.svelte';
  import IconButton from '../components/common/IconButton.svelte';
  import MessageList from '../components/messages/MessageList.svelte';
  import SessionsList from '../components/sessions/SessionsList.svelte';
  import type { SidebarRenderState, ThemeMode, VsCodeApi } from '../types';

  export let state: SidebarRenderState;
  export let theme: ThemeMode;
  export let vscode: VsCodeApi | undefined;

  type Screen = 'home' | 'thread';

  let prompt = '';
  let transcript: HTMLDivElement | undefined;
  let expanded = new Set<string>();
  let screen: Screen = 'home';
  let previousChatId = '';
  let editingMessageId: string | undefined = undefined;
  let contextMenu:
    | { messageId: string; text: string; x: number; y: number }
    | undefined = undefined;

  $: chat = state.chat ?? {
    messages: [],
    isResponding: false,
    availableTools: [],
    activeChatId: '',
    history: [],
    activeMode: 'agent',
    activeApprovalPolicy: 'safeOnly',
    activeEnvironmentScope: 'local',
    customAgents: []
  };
  $: availableModels = state.availableModels ?? [];
  $: selectedModelId = state.snapshot.selectedModelId
    ?? chat.history.find((item) => item.id === chat.activeChatId)?.modelId
    ?? availableModels[0]?.id
    ?? '';
  $: activeChat = chat.history.find((item) => item.id === chat.activeChatId);
  $: if (chat.messages.some((message) => message.error && (message.role === 'thinking' || message.role === 'tool'))) {
    expanded = new Set([
      ...expanded,
      ...chat.messages
        .filter((message) => message.error && (message.role === 'thinking' || message.role === 'tool'))
        .map((message) => message.id)
    ]);
  }
  $: if (chat.activeChatId !== previousChatId) {
    if (chat.activeChatId && (chat.messages.length > 0 || screen === 'thread')) {
      screen = 'thread';
    }
    previousChatId = chat.activeChatId;
  }
  $: void scrollToBottom(chat.messages.length, chat.isResponding, screen);

  const validatedAt = state.snapshot.accountSummary?.validatedAt
    ? new Date(state.snapshot.accountSummary.validatedAt).toLocaleString()
    : 'Not validated yet';

  const healthLabel =
    state.snapshot.connectionHealth === 'connected'
      ? 'Connected'
      : state.snapshot.connectionHealth === 'degraded'
        ? 'Attention needed'
        : 'Signed out';

  function postMessage(message: Record<string, unknown>) {
    vscode?.postMessage(message);
  }

  function submitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || chat.isResponding) {
      return;
    }

    screen = 'thread';
    if (editingMessageId) {
      postMessage({
        command: 'nova.chat.editAndResubmit',
        messageId: editingMessageId,
        prompt: trimmed
      });
      editingMessageId = undefined;
    } else {
      postMessage({
        command: 'nova.chat.submit',
        prompt: trimmed
      });
    }
    prompt = '';
  }

  function openChat(chatId: string) {
    screen = 'thread';
    postMessage({
      command: 'nova.chat.switch',
      chatId
    });
  }

  function createChat() {
    screen = 'thread';
    editingMessageId = undefined;
    postMessage({ command: 'nova.chat.create' });
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expanded = next;
  }

  function openUserContextMenu(message: { id: string; text: string }, event: MouseEvent) {
    contextMenu = {
      messageId: message.id,
      text: message.text,
      x: event.clientX,
      y: event.clientY
    };
  }

  function beginEditFromContextMenu() {
    if (!contextMenu) {
      return;
    }
    prompt = contextMenu.text;
    editingMessageId = contextMenu.messageId;
    contextMenu = undefined;
  }

  async function scrollToBottom(_count: number, _responding: boolean, currentScreen: Screen) {
    await tick();
    if (currentScreen === 'thread') {
      transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
    }
  }
</script>

<section class="main-page" data-theme={theme}>
  {#if contextMenu}
    <button class="context-overlay" onclick={() => contextMenu = undefined}></button>
    <div class="context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px;`}>
      <button onclick={beginEditFromContextMenu}>Edit and resubmit</button>
    </div>
  {/if}
  {#if screen === 'home'}
    <div class="home-view">
      <header class="top-toolbar">
        <div class="title-copy">
          <strong>Chat</strong>
          <span>{healthLabel} · {validatedAt}</span>
        </div>
        <div class="toolbar-actions">
          <IconButton title="New chat" icon={plusLgIcon} onclick={createChat} />
          <IconButton title="Refresh models" icon={arrowClockwiseIcon} onclick={() => postMessage({ command: COMMAND_REFRESH_MODELS })} />
          <IconButton title="Extension settings" icon={gearIcon} onclick={() => postMessage({ command: COMMAND_OPEN_SETTINGS })} />
          <IconButton title="Sign out" icon={boxArrowRightIcon} onclick={() => postMessage({ command: COMMAND_SIGN_OUT })} />
        </div>
      </header>

      <div class="home-content">
        {#if chat.history.length}
          <SessionsList
            activeChatId={chat.activeChatId}
            sessions={chat.history}
            onswitch={openChat}
            onrename={(id) => postMessage({ command: 'nova.chat.rename', chatId: id })}
            onarchive={(id) => postMessage({ command: 'nova.chat.archive', chatId: id })}
            ondelete={(id) => postMessage({ command: 'nova.chat.delete', chatId: id })}
          />
        {:else}
          <div class="empty-state">
            <p class="empty-title">No chats yet.</p>
            <p>Create a chat to start a dedicated conversation view.</p>
            <button class="primary-action" onclick={createChat}>New chat</button>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="thread-view">
      <header class="thread-toolbar">
        <div class="thread-heading">
          <button class="back-button" onclick={() => screen = 'home'}>
            <span aria-hidden="true">{@html arrowLeftIcon}</span>
            <strong>Chat</strong>
          </button>
          <div class="thread-title">
            <strong>{activeChat?.title ?? 'New chat'}</strong>
            <span>{healthLabel} · {validatedAt}</span>
          </div>
        </div>
        <div class="toolbar-actions">
          <IconButton title="New chat" icon={plusLgIcon} onclick={createChat} />
          <IconButton title="Refresh models" icon={arrowClockwiseIcon} onclick={() => postMessage({ command: COMMAND_REFRESH_MODELS })} />
          <IconButton title="Extension settings" icon={gearIcon} onclick={() => postMessage({ command: COMMAND_OPEN_SETTINGS })} />
        </div>
      </header>

      <div class="transcript" bind:this={transcript}>
        {#if !chat.messages.length}
          <div class="empty-state">
            <p class="empty-title">Start this chat.</p>
            <p>Once you send the first message, this conversation stays here and you can always go back to Chats.</p>
          </div>
        {:else}
          <MessageList
            messages={chat.messages}
            {expanded}
            ontoggleTrace={toggleExpanded}
            activeToolId={chat.activeToolId}
            onusercontextmenu={openUserContextMenu}
          />
        {/if}
      </div>

      <div class="composer-dock">
        {#if editingMessageId}
          <div class="edit-banner">
            <span>Editing previous message</span>
            <button onclick={() => { editingMessageId = undefined; prompt = ''; }}>Cancel</button>
          </div>
        {/if}
        <ChatComposer
          value={prompt}
          disabled={chat.isResponding}
          editing={!!editingMessageId}
          activeMode={chat.activeMode}
          activeCustomAgentId={chat.activeCustomAgentId}
          activeApprovalPolicy={chat.activeApprovalPolicy}
          activeEnvironmentScope={chat.activeEnvironmentScope}
          customAgents={chat.customAgents}
          models={availableModels}
          {selectedModelId}
          toolCount={chat.availableTools.length}
          oninput={(value) => prompt = value}
          onsubmit={submitPrompt}
          onselectMode={(mode) => postMessage({ command: 'nova.chat.selectMode', mode })}
          onselectCustomAgent={(customAgentId) => postMessage({ command: 'nova.chat.selectCustomAgent', customAgentId })}
          onconfigureAgents={() => postMessage({ command: 'nova.chat.configureAgents' })}
          onopenModelPicker={() => postMessage({ command: 'nova.chat.pickModel' })}
          onopenEnvironmentPicker={() => postMessage({ command: 'nova.chat.pickEnvironment' })}
          onopenApprovalPicker={() => postMessage({ command: 'nova.chat.pickApprovalPolicy' })}
        />
      </div>
    </div>
  {/if}
</section>

<style lang="scss">
  .main-page,
  .home-view,
  .thread-view {
    position: relative;
    min-height: 100vh;
    background: var(--bg);
    color: var(--fg);
  }

  .home-view,
  .thread-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-5);
    padding: var(--space-4);
  }

  .thread-view {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .top-toolbar,
  .thread-toolbar {
    min-height: 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .thread-heading,
  .title-copy,
  .thread-title {
    min-width: 0;
    display: grid;
    gap: var(--space-1);
  }

  .title-copy strong,
  .thread-title strong,
  .back-button strong {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .title-copy span,
  .thread-title span {
    color: var(--muted);
    font-size: var(--font-meta);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .home-content,
  .transcript {
    min-height: 0;
    overflow: auto;
  }

  .transcript {
    padding-right: var(--space-2);
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--fg);
  }

  .back-button span :global(svg) {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .thread-heading {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
  }

  .composer-dock {
    position: sticky;
    bottom: 0;
    padding-top: var(--space-2);
    background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent), var(--bg) 22%);
  }

  .edit-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--divider);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--selected-soft-bg) 70%, var(--bg));
    color: var(--muted);
    font-size: var(--font-meta);
  }

  .edit-banner button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--fg);
  }

  .context-overlay {
    position: fixed;
    inset: 0;
    border: 0;
    background: transparent;
    z-index: 29;
  }

  .context-menu {
    position: fixed;
    z-index: 30;
    min-width: 168px;
    padding: var(--space-2);
    border: 1px solid var(--divider);
    border-radius: var(--radius-md);
    background: var(--panel-elevated-bg);
    box-shadow: var(--shadow-menu);
  }

  .context-menu button {
    width: 100%;
    min-height: var(--control-md);
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    text-align: left;
  }

  .context-menu button:hover {
    background: var(--hover-bg);
  }

  .empty-state {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-7);
    border: 1px dashed var(--divider);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--panel-soft-bg) 72%, transparent);
    color: var(--muted);
  }

  .empty-title {
    margin: 0;
    color: var(--fg);
    font-size: 14px;
    font-weight: 600;
  }

  .empty-state p {
    margin: 0;
  }

  .primary-action {
    width: fit-content;
    min-height: var(--control-md);
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-fg);
  }
</style>
