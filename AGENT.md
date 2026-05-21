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
- `src/model/modelProvider.ts` — implements `vscode.LanguageModelChatProvider`, 10-min model cache, streams responses, maps HTTP errors to `LanguageModelError`, detects tool-calling support via 400-response heuristics
- `src/chat/AgentParticipant.ts` — chat participant `nova-ai.nova`, max 6 tool rounds, builds VS Code chat history, reports token usage
- `src/status/StatusBar.ts` — context window % usage, color-coded (yellow ≥70%, red ≥90%)
- `src/core/` — shared types, constants, error mapping, diagnostics
- `src/views/` — sidebar `WebviewViewProvider`, loads Vite-built assets from `out/webview/`, injects `window.__NOVA_SIDEBAR_STATE__` via bootstrap script

**Webview** (webview/ → out/webview/, Vite + Svelte 5)

- Entry: `webview/index.html` + `webview/src/main.ts`
- Three views: `WelcomeView.svelte`, `ApiKeyView.svelte`, `MainView.svelte`
- Receives initial state from `window.__NOVA_SIDEBAR_STATE__` (injected by extension)
- Built with manifest so `ViewProvider` can rewrite asset URIs to `vscode-resource:` scheme

**Data flow:** `SessionService` owns state → `ModelProvider` reads session for client/models → `AgentParticipant` calls provider → `StatusBar` reflects token usage → `ViewProvider` reflects session in webview.

## Key patterns

- `@datalabrotterdam/nova-sdk` is the only runtime dependency; all VS Code APIs are peer/dev
- `src/types/vscode-proposed.d.ts` — proposed VS Code APIs (requires `enabledApiProposals: ["chatParticipantAdditions"]` in package.json)
- Token estimation: `Math.ceil(length / 4)` in `tokenEstimator.ts`
- `NOVA_USAGE_MIME_TYPE = "application/vnd.nova-ai.usage+json"` — streamed usage data from SDK
- Tests mock `vscode` via `tests/mocks/vscode.ts`; vitest alias maps `vscode` → mock

## Release

Semantic Release on `main` (stable) and `alpha` (prerelease) branches. CI runs `scripts/prepare-vsce-prerelease-version.mjs` to align package.json version with pre-release VSIX naming before publishing to VS Code Marketplace and Open VSX.
