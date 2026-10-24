# Roadmap: Nova AI next to Claude Code and Codex

Status on 2026-10-24 (extension `1.0.0-alpha.34`). Where Nova stands against Claude
Code and Codex: what is done, what is still open, and why. Update this file as work
lands.

## Done

| Feature | PR | Notes |
|---|---|---|
| **Own MCP client with OAuth** | #14 | stdio, Streamable HTTP and SSE. Config in `~/.nova-ai/mcp.json`, `.mcp.json` and `.nova-ai/mcp.json`. Sign-in uses dynamic client registration and a loopback redirect; tokens go to Secret Storage. **Nova AI: MCP Servers** manages the servers. |
| **Hooks** (Claude Code format) | #15 | PreToolUse, PostToolUse, UserPromptSubmit, SessionStart and Stop. Exit code 2 blocks. Workspace hooks run only in a trusted workspace. |
| **Git commands** | #16 | `/commit`, `/review`, and `/pr` (alias `/mr`). `/pr` uses `gh` or `glab`, otherwise opens the host's compare page. |
| **Background coding agents** | #17 | `start_coding_agent` runs each agent on its own branch and git worktree. When it is done you can Review, Merge or Discard. Agents survive the end of the answer; after a reload they show as *interrupted*. |
| **Cost and usage** | #20 | Tokens and cost per chat and per agent, computed from the model's price. Also fixes the price label (the gateway sends `inputCostPer1M`). |
| **Slash commands** | #21 | Markdown command files (`~/.nova-ai/commands`, `.nova-ai/commands`), skills as `/name`, and MCP prompts as `/mcp__server__prompt`. When an MCP server needs a sign-in, the chat shows a notice with a **Sign in** button. |
| **Checkpoints and rewind** | #22 | Rewind code, chat or both to before a message. Keep or Undo each change (hunk) on its own. The change list survives a reload. |
| **Inline editing** | #23 | **Edit Selection with Nova** (diff, then Apply). Tab completions are opt-in (`nova.inline.tabEnabled`). |
| **Semantic code search** | #24 | `semantic_search` with the gateway's embedding model. The index lives in `projects/<key>/index` and updates incrementally. |
| **Nova Settings page** | #24 | All settings in grouped sections, models picked from a list, User or Workspace scope. Also adds **Nova AI: Choose Models**. |
| **CLI parity, partly** | nova-ai-cli | The CLI reads command files and supports autopilot and hooks. Its `rules.ts` understands `mcp__server__*`. |

## Still to do

Ordered by value for the effort it takes.

### 1. CLI: read `mcp.json` (nova-ai-cli)
- **What:** `packages/agent/src/core/workspace-mcp.ts` should also read `~/.nova-ai/mcp.json` (the user's) and `<cwd>/.nova-ai/mcp.json` (only in a trusted workspace). The merge order matches the extension's `src/mcp/config.ts`.
- **Why:** both tools share `~/.nova-ai`. Today a server added in the extension does not exist in the CLI, which goes against the contract in `docs/NOVA_HOME.md`.

### 2. CI integration (nova-ai-cli)
- **What:**
  - A composite GitHub Action (`action.yml`) and an includable GitLab template.
  - Both run `nova-ai -p "…" --output-format json` with `NOVA_API_KEY`.
  - Default `--permission-mode read-only`, and optionally post the result as a PR/MR comment (`gh pr comment` / `glab mr note`).
  - Document the exit codes 0/1/2/3, and the risk of fork PRs and secrets.
- **Why:** Codex and Claude Code review PRs and fix pipelines in CI. Headless mode already exists; only the packaging and docs are missing.

### 3. Voice input (extension)
- **What:** a microphone button in the composer, sending audio through `audio.transcriptions.create` (already in the SDK and gateway).
- **Why:** small effort, and both competitors have it.

### 4. File watcher for the search index (extension)
- **What:**
  - Mark changed files from a `FileSystemWatcher` instead of checking every file's modification time on each search.
  - Show progress during the first index build.
- **Why:** each search now checks up to 5,000 files, and the first build shows only a spinner. That is noticeable in large repositories.

### 5. Exporting and sharing chats (extension)
- **What:** export a chat as Markdown, with an optional share link.
- **Why:** handing a chat to a colleague or attaching it to an issue.

### 6. Syncing skills, agents and commands
- **What:** sync `~/.nova-ai/{skills,agents,commands}` across machines, for example through Settings Sync or an account store on the gateway.
- **Why:** VS Code settings sync; Nova's own folders do not.

### Needs work outside this repo
- **Cloud background agents:** coding agents run on your own machine and stop when the window closes. Codex runs tasks in the cloud. This needs an agent runtime service; the gateway has none (`nova-ai-next`, `PLAN.md`: agent orchestration belongs to the applications).
- **Fill-in-the-middle in the gateway:** Tab completions now go through a chat model, which is slower and less precise. A `/v1/completions` route with `suffix` in `nova-ai-gateway` would make them as good as dedicated completion engines.

## Known limits of what is built

These are deliberate simplifications. Pick one up when users run into it.

- **Rewind:**
  - It only undoes edits made with Nova's edit tools. The effects of commands stay; Nova lists them before you rewind.
  - Files over about 1 MB get no checkpoint.
- **Coding agents:**
  - Their branch commits skip repository hooks (`--no-verify`), because worktrees have no `node_modules`.
  - When the user has another chat open, an agent's approval card appears there.
  - They cannot use semantic search, because the index only covers the open workspace.
- **Cost:** a chat that mixes models with different currencies shows the last model's currency. Cached tokens are charged at the input price, so the figure is an estimate (≈).
- **Command files:**
  - The chat shows the expanded prompt instead of `/name args`.
  - `allowed-tools` is ignored.
- **Tab completions:** they come from a chat model (see fill-in-the-middle above), and every pause in typing costs tokens.

## Not verified against real services yet

- `/pr` against a real GitHub and a real GitLab repository. The tests use fake `gh`/`glab` scripts.
- Semantic search with other embedding models than the one used during development.
- How good Tab completions are on the deployed models.
