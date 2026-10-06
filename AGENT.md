# AGENT.md

This file provides guidance to agents when working with code in this repository.

## Commands

```bash
npm run compile          # Full build: clean → webview (Vite) → typecheck → extension (esbuild)
npm run build:extension  # Extension only (esbuild, node22, CJS)
npm run build:webview    # Webview only (Vite + Svelte)
npm run dev:webview      # Webview watch mode
npm run typecheck        # tsc --noEmit
npm test                 # Vitest (auto-compiles first via pretest)
npm run package:vsix     # Build pre-release VSIX → dist/
npm run verify           # npm test && npm run package:vsix
```

Run single test file:

```bash
npx vitest run tests/errors.test.ts
```

## Architecture

Two separate build targets in one repo:

**Extension** (src/ → out/, esbuild, node22 CJS)

- Entry: `src/extension.ts` — wires all services, registers commands and chat participant
- `src/services/SessionService.ts` — API key in VS Code SecretStorage, session state machine (`signedOut | connected | degraded`), emits `onDidChangeSession`
- `src/model/modelProvider.ts` — implements `vscode.LanguageModelChatProvider`, 10-min model cache, maps HTTP errors to `LanguageModelError`, learns tool-calling support per model (unknown = offered as tool-capable), identity rewrite, context safety net + overflow retry
- `src/model/messages.ts` — VS Code messages → OpenAI-style messages (no empty bodies, tool results right after their calls, orphan pruning, same-role merging, images for vision models)
- `src/model/streamParser.ts` — stream chunks → text / thinking / tool calls (argument accumulation + JSON repair, `<think>` and `reasoning_content`, text-embedded tool calls via `textToolCalls.ts`)
- `src/model/toolSchema.ts` — tool payload, schema normalization, tool-name sanitizing (`ToolNameMap`), 128-tool cap
- `src/model/identity.ts` — rewrites the Copilot identity in system prompts to Nova
- `src/agent/AgentLoop.ts` — model ↔ tool loop shared by `@nova` and the Nova chat panel; auto-compaction, overflow recovery
- `src/agent/tools/` — the panel's built-in tools (`NovaTool`: `prepare` for the approval card/diff, then `invoke`); paths are confined to the workspace by `workspacePaths.ts`
- `src/panel/ChatController.ts` — Nova chat panel runtime: sessions, approvals (`nova.agent.approvalMode`), tool dispatch (built-in + `mcp_*`), diff previews via `ProposedContentProvider`; persisted by `SessionStore` (workspace storage)
- `src/agent/tools/interactionTools.ts` — panel-only `todo_write` (task strip) and `ask_user` (question card; waits like an approval) via an `InteractionHost` implemented by `ChatController`; no tool cards for them
- `src/panel/slashCommands.ts` — panel slash commands (`/clear`, `/compact`, `/model`, `/rename`, `/help`): definitions, parsing and composer suggestions, shared with the webview (no `vscode` import); `ChatController.send` runs them, unknown `/words` are sent as messages
- `src/core/help.ts` — `Nova AI: Help` / `/help`: opens `resources/help/HELP.md` (user guide to the whole extension) in the Markdown preview; update it with user-facing features (a test checks the slash commands are listed)
- `src/panel/protocol.ts` — type-only message protocol shared with the webview (`chat/*` commands and events)
- `src/storage/NovaHome.ts` — `~/.nova-ai` layout; per-workspace folder `projects/<slug>-<hash8>` (sha256 of the normalized workspace path; `project.json` maps back)
- `src/memory/MemoryService.ts` — global and project `MEMORY.md` index in ~/.nova-ai plus typed notes in `memory/<name>.md` next to each, repo `NOVA.md`/`AGENTS.md` (read-only) → prompt section; `memory_read`/`memory_write` tools (incl. `save_note`/`delete_note`) in `src/agent/tools/memoryTools.ts`. The ~/.nova-ai layout is shared with nova-ai-cli: `docs/NOVA_HOME.md` is the contract, keep both repos in sync
- `src/permissions/PermissionService.ts` — allow/deny rules from `~/.nova-ai/settings.json` and `<workspace>/.nova-ai/settings(.local).json`; deny wins; workspace allow only when trusted
- `src/services/ProfileService.ts` — user avatar for the webview: `AccountSummary.profile.avatarUrl` is downloaded (raster images ≤ 1 MB) and passed as a data: URI; falls back to initials, then an icon. Fill `profile` in `SessionService.fetchAccountSummary` once the Nova API exposes the current user.
- Scratch: `setScratchRoot()` in `workspacePaths.ts` lets tools use `scratch/...` paths in the project's scratch folder
- `src/agent/ContextManager.ts` — token budget, per-model calibration, staged compaction (prune → summarize → trim)
- `src/chat/AgentParticipant.ts` — chat participant `nova-ai.nova`; history replay from `ChatResult.metadata`, references, `/explain` `/fix` `/tests` `/compact`
- `src/core/apiSupport.ts` — feature detection for API proposals; never touch proposed APIs directly
- `src/status/StatusBar.ts` — context window % usage, color-coded (yellow ≥70%, red ≥90%)
- `src/core/` — shared types, constants, error mapping, diagnostics
- `src/views/` — sidebar `WebviewViewProvider`, loads Vite-built assets from `out/webview/`, injects `window.__NOVA_SIDEBAR_STATE__` via bootstrap script

**Webview** (webview/ → out/webview/, Vite + Svelte 5)

- Entry: `webview/index.html` + `webview/src/main.ts`
- Views: `WelcomeView.svelte`, `ApiKeyView.svelte`, `chat/ChatView.svelte` (default when signed in), `MainView.svelte` (account)
- Chat: `chat/store.svelte.ts` applies `chat/*` events; `chat/markdown.ts` renders with marked + DOMPurify (raw HTML escaped)
- Receives initial state from `window.__NOVA_SIDEBAR_STATE__` (injected by extension)
- Built with manifest so `ViewProvider` can rewrite asset URIs to `vscode-resource:` scheme

**Data flow:** `SessionService` owns state → `ModelProvider` reads session for client/models → `AgentParticipant` calls provider → `StatusBar` reflects token usage → `ViewProvider` reflects session in webview.

## Key patterns

- `@datalabrotterdam/nova-sdk` is the only runtime dependency; all VS Code APIs are peer/dev
- `src/types/vscode-proposed.d.ts` — optional typings for the proposals in `enabledApiProposals`; proposals are only active in Insiders or for allowlisted extensions, so always go through `src/core/apiSupport.ts`
- `resources/chat/` — contributed custom agent (`chatAgents`) and prompt files (`chatPromptFiles`)
- Webview: Svelte 5 runes, codicons, colors only from `--vscode-*` variables (`webview/src/app.scss`); the document renders once and state updates arrive via `postMessage`
- Token estimation: `Math.ceil(utf8Bytes / 3)` in `tokenEstimator.ts` (images count as 1,000), corrected per model by `tokenCalibration`; 2%/1,024-token context headroom in `modelProvider.ts`; unknown windows use `nova.context.defaultContextWindow`
- `NOVA_USAGE_MIME_TYPE = "application/vnd.nova-ai.usage+json"` — streamed usage data from SDK
- Tests mock `vscode` via `tests/mocks/vscode.ts`; vitest alias maps `vscode` → mock

## Release

Semantic Release on `main` (stable) and `alpha` (prerelease) branches. CI runs `scripts/prepare-vsce-prerelease-version.mjs` to align package.json version with pre-release VSIX naming before publishing to VS Code Marketplace and Open VSX.
