<script lang="ts">
    import arrowClockwiseIcon from "bootstrap-icons/icons/arrow-clockwise.svg?raw";
    import arrowUpIcon from "bootstrap-icons/icons/arrow-up.svg?raw";
    import boxArrowRightIcon from "bootstrap-icons/icons/box-arrow-right.svg?raw";
    import chatDotsIcon from "bootstrap-icons/icons/chat-dots.svg?raw";
    import clockHistoryIcon from "bootstrap-icons/icons/clock-history.svg?raw";
    import gearIcon from "bootstrap-icons/icons/gear.svg?raw";
    import pencilSquareIcon from "bootstrap-icons/icons/pencil-square.svg?raw";
    import {
        COMMAND_OPEN_CHAT,
        COMMAND_OPEN_SETTINGS,
        COMMAND_REFRESH_MODELS,
        COMMAND_SIGN_OUT,
    } from "../../../src/core/constants";
    import type {SidebarRenderState, ThemeMode, VsCodeApi} from "../types";

    export let state: SidebarRenderState;
    export let theme: ThemeMode;
    export let vscode: VsCodeApi | undefined;

    const validatedAt = state.snapshot.accountSummary?.validatedAt
        ? new Date(state.snapshot.accountSummary.validatedAt).toLocaleString()
        : "Not validated yet";

    const healthLabel =
        state.snapshot.connectionHealth === "connected"
            ? "Connected"
            : state.snapshot.connectionHealth === "degraded"
                ? "Attention needed"
                : "Signed out";
    state.snapshot.accountSummary?.providerNames.join(", ") || "Nova runtime";
    const modelName =
        state.preferredModel?.name ??
        state.snapshot.selectedModelId ??
        "Default model";

    function sendCommand(command: string) {
        vscode?.postMessage({command});
    }
</script>

<section class="main-page" data-theme={theme}>
    <header class="action-strip">
        <span class="section-label">Tasks</span>
        <button
                class="icon-button"
                title="Refresh models"
                aria-label="Refresh models"
                onclick={() => sendCommand(COMMAND_REFRESH_MODELS)}
        >
            {@html arrowClockwiseIcon}
        </button>
        <button
                class="icon-button"
                title="Open Nova AI settings"
                aria-label="Open Nova settings"
                onclick={() => sendCommand(COMMAND_OPEN_SETTINGS)}
        >
            {@html gearIcon}
        </button>
        <button
                class="icon-button"
                title="Sign out"
                aria-label="Sign out"
                onclick={() => sendCommand(COMMAND_SIGN_OUT)}
        >
            {@html boxArrowRightIcon}
        </button>
    </header>

    <div class={`account-status ${state.snapshot.connectionHealth}`}>
        <span>{healthLabel}</span>
        <span>{validatedAt}</span>
    </div>

    <div class="task-list">
        <div class="task-row notice-row">
            <span class="row-icon" aria-hidden="true">{@html clockHistoryIcon}</span>
            <span class="row-copy">
        <strong>Work in progress</strong>
        <small>Nova can now be used through Early Access in VS Code Chat.</small
        >
      </span>
        </div>

        <button class="task-row" onclick={() => sendCommand(COMMAND_OPEN_CHAT)}>
            <span class="row-icon" aria-hidden="true">{@html chatDotsIcon}</span>
            <span class="row-copy">
        <strong>Start a Nova chat</strong>
        <small>{modelName}</small>
      </span>
            <span class="row-meta">Open</span>
        </button>
    </div>

    <div class="empty-mark" aria-hidden="true">
        {#if state.logoUri}
            <img src={state.logoUri} alt=""/>
        {/if}
    </div>

    <button class="chat-opener" onclick={() => sendCommand(COMMAND_OPEN_CHAT)}>
        <span class="opener-icon" aria-hidden="true">{@html pencilSquareIcon}</span>
        <span>Ask Nova in VS Code Chat</span>
        <span class="send-icon" aria-hidden="true">{@html arrowUpIcon}</span>
    </button>

    <p class="ai-disclaimer">AI can make mistakes. Review important output.</p>
</section>

<style lang="scss">
  .main-page {
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto auto minmax(0, auto) 1fr auto auto;
    gap: 8px;
    padding: 14px 12px 12px;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
  }

  .action-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
  }

  .section-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 14px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-button,
  .row-icon,
  .opener-icon,
  .send-icon {
    display: grid;
    place-items: center;
    color: var(--muted);

    :global(svg) {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }
  }

  .icon-button {
    width: 26px;
    height: 26px;
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    background: transparent;

    &:hover {
      background: var(--row-hover);
      color: var(--fg);
    }
  }

  .account-status {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--muted);
    font-size: 12px;

    &.connected span:first-child {
      color: var(--vscode-testing-iconPassed, var(--fg));
    }

    &.degraded span:first-child {
      color: var(--vscode-testing-iconQueued, var(--fg));
    }
  }

  .task-list {
    display: grid;
    align-content: start;
    gap: 1px;
  }

  .task-row {
    width: 100%;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 4px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--fg);
    text-align: left;

    &:hover {
      background: var(--row-hover);
    }
  }

  .notice-row {
    background: color-mix(in srgb, var(--input-bg) 64%, transparent);
    cursor: default;
  }

  .row-copy,
  .row-copy strong,
  .row-copy small,
  .row-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-copy {
    display: grid;
    gap: 2px;
  }

  .row-copy strong {
    display: block;
    font-size: 13px;
    font-weight: 620;
  }

  .row-copy small,
  .row-meta {
    color: var(--muted);
  }

  .row-meta {
    font-size: 11px;
  }

  .empty-mark {
    display: grid;
    place-items: center;
    opacity: 0.24;
  }

  .empty-mark img {
    width: 54px;
    height: 54px;
    filter: grayscale(1);
  }

  .chat-opener {
    min-height: 38px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--muted);
    text-align: left;

    &:hover {
      background: var(--row-hover);
      color: var(--fg);
    }

    span:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .send-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-fg);
  }

  .ai-disclaimer {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
    text-align: center;
  }
</style>
