# Moving the extension's agent onto `nova-ai --acp`

Status: proposal (2026-10-03). Covers the chat panel and the `@nova` chat
participant. The language-model provider stays as it is.

## Why

The extension and `nova-ai-cli` each run their own coding agent: loop, tools,
context handling, permission policy, memory and sessions. That is about
3–4k lines in this repo doing what the CLI's agent does, and the two drift:
`rules.ts` and the `~/.nova-ai` contract are already kept in sync by hand.

The CLI's agent speaks the [Agent Client Protocol](https://agentclientprotocol.com)
and is published on its own as `@datalabrotterdam/nova-ai-agent` (command
`nova-ai-agent --acp`, no UI libraries; reference: `nova-ai-cli/docs/ACP.md`).
The CLI's terminal UI and
headless mode use only that protocol, and so do Zed and JetBrains. If the
extension does the same, there is:

- one agent, one permission policy, one session format;
- continuity: a chat started in the terminal can be continued in VS Code, and
  the other way round;
- every agent fix and feature reaching both;
- the extension testing the ACP agent in daily use.

## What changes and what stays

| Part | Today | After |
|---|---|---|
| Chat panel (`panel/ChatController.ts`, webview) | Own `AgentLoop`, tools, approvals, sessions | ACP client; the webview and its protocol stay largely the same |
| `@nova` participant (`chat/AgentParticipant.ts`) | Own `AgentLoop` with VS Code's tool invocation | ACP client (phase D; see "The participant") |
| Language-model provider (`model/modelProvider.ts`) | Nova models in VS Code's model picker | **Unchanged**: not an agent |
| Tools registered for Copilot (`agent/tools/vscodeTools.ts`) | Memory + `fetch_url` for other chat agents | Unchanged, or thinned out later |
| Sign-in, status bar, sidebar account and history views | Extension | Unchanged; history lists the agent's sessions |
| `agent/` (loop, tools, `ContextManager`), `permissions/`, `memory/MemoryService`, `panel/SessionStore` | Extension | **Removed** once the panel and the participant run on ACP |

### How the agent runs

The extension depends on `@datalabrotterdam/nova-ai-agent` (not the CLI: the
terminal UI and its Ink/React dependencies are not needed) at a pinned version
and starts it as a child process:

```ts
spawn(process.execPath, [require.resolve('@datalabrotterdam/nova-ai-agent/bin.js'), '--acp'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NOVA_API_KEY: key, NOVA_AI_HOME: novaHome },
});
```

- **Child process, not in-process**: a hung turn, a heavy MCP server or a
  crash cannot block the extension host (shared by all extensions); the
  agent's own process-tree cleanup and shutdown on stdin EOF are reused;
  Remote Control can later attach the same way. The extension is Node-only
  already (no `browser` entry) and already starts processes. Remote (SSH, WSL,
  containers) works because the extension host runs on the remote side.
- **Credentials** stay in VS Code's secret storage and reach the agent as
  `NOVA_API_KEY` (the agent's `env_var` auth method). No key file is written.
- **`nova.home`** becomes `NOVA_AI_HOME`.
- **Version check**: `initialize` returns `agentInfo.version` (the agent
  package's version) and `_meta["nova-ai-cli"].version` (extension API version). The extension
  refuses an agent whose extension API version it does not know.
- One agent process per window, started on first use, stopped on
  `deactivate` (closing stdin ends it cleanly).
- **Optional: "Open Nova in terminal".** Because the terminal UI and the panel
  use the same sessions in `~/.nova-ai`, a command can open the terminal UI in
  VS Code's integrated terminal (`nova-ai --resume <id>` for the current
  chat). It runs an installed `nova-ai` (or `npx @datalabrotterdam/nova-ai-cli`)
  instead of bundling the TUI into the extension.

## Feature comparison

Legend: ✅ the ACP agent already does this · 🟡 small change · 🔴 new work.

### Conversation

| Panel feature | ACP agent today | Status / work |
|---|---|---|
| Streamed answer (`chat/textDelta`) | `agent_message_chunk` | ✅ |
| Thinking (`kind: 'thinking'`) | `agent_thought_chunk` | ✅ |
| Notices (info/warning/error) | errors, `stopReason`, status updates | ✅ map in the client |
| Stop (`chat/stop`) | `session/cancel` | ✅ |
| Usage `{used, total}` | `usage_update`, `_nova/session/context_usage` | ✅ |
| Title | `session_info_update` | ✅ |
| Auto-compaction, `/compact` | agent compacts on overflow; `/compact` command | ✅ (settings: see below) |
| Model picker (`chat/selectModel`, `maxInputTokens`) | `model` config option; `providers/list` `_meta` | 🟡 add the context window to the model list `_meta` |
| Attachments: files and selections with line ranges | prompt `resource_link` / embedded `resource` blocks | 🟡 confirm line ranges (URI fragment `#L10-L20`) are read; test |
| Edit an earlier message and resend (`chat/editMessage`) | `_nova/session/rewind` by completed turns | 🟡 the client counts turns after the edited message; editing a steered message (not a turn start) is not offered |

### Queue and steering

| Panel feature | ACP agent today | Status / work |
|---|---|---|
| Queue while working, steer at the next step | `_nova/queue/*` with `kind: followup | steer`, injected at the next tool boundary | ✅ |
| Switch an entry between queue and steer (`chat/queueMode`) | `_nova/queue/update` has no `kind` | 🟡 accept `kind` in `queue/update` |
| Remove (`chat/queueRemove`) | `_nova/queue/remove` | ✅ |
| Send now (`chat/queueSendNow`) | — | 🟡 = switch to steer and move to the front (`front` on update) |

### Tools

| Extension tool | ACP agent | Status / work |
|---|---|---|
| `read_file`, `edit_file`, `search_text`, `run_command`, `ask_user`, `memory_read`, `memory_write` | same names | ✅ |
| `list_dir` | `list_directory` | 🟡 alias the name so existing rules (`list_dir(...)`) keep matching |
| `create_file` | `write_file` | 🟡 alias, as above |
| `todo_write` | `update_plan` (ACP `plan`) | ✅ different name, same feature; alias for rules |
| `find_files` (glob) | — | 🔴 add to the agent (workspace-confined; `.gitignore`, `node_modules` excluded) |
| `fetch_url` | — | 🔴 add to the agent; **network egress = approval required** (it can carry code out in a URL); rule subject is the URL (already in `NOVA_HOME.md`) |
| `get_diagnostics` (VS Code problems) | — | 🔴 editor-only: provided by the extension's MCP bridge (below) |
| VS Code MCP tools (`mcp_*`, `nova.agent.includeMcpTools`) | agent connects MCP servers given in `session/new` | 🔴 MCP bridge (below) |
| MCP servers from `.mcp.json` / `.nova-ai/settings.json` | ✅ agent reads them (trusted workspaces) | ✅ |

**MCP bridge.** The extension runs a small MCP server on `127.0.0.1` (random
port, bearer token) and passes it to the agent as an `http` server in
`session/new`. It exposes what only the editor has: `get_diagnostics` and the
VS Code-managed MCP tools (`vscode.lm.invokeTool`). This needs no
Nova-specific protocol and also works for other editors. Open point: the agent
should honour MCP `readOnlyHint` annotations, so diagnostics don't need
approval every time.

### Files and edits

| Panel feature | ACP agent today | Status / work |
|---|---|---|
| Edits see unsaved editor buffers | client `fs/read_text_file` / `fs/write_text_file` | ✅ the extension implements these with VS Code documents |
| Diff in the tool card, "Open diff" | `diff` content in `tool_call` | ✅ render it; `ProposedContentProvider` stays |
| Keep / Undo per file or all (`chat/keepChange`, `chat/undoChange`) | — | ✅ **stays in the extension**: every write goes through the client's `fs/write_text_file`, so the extension records the baseline exactly as today |
| Command execution | client `terminal/*` or agent-side | 🟡 the extension implements ACP terminals (process tree kill as in `terminalTool.ts`); `nova.agent.commandTimeoutSeconds` → `terminal/create` timeout |

### Permissions

| Panel feature | ACP agent today | Status / work |
|---|---|---|
| Approval card: approve, this session, always, reject | `session/request_permission` with `allow_once`, `allow_session`, `allow_always`, `reject_once` | ✅ |
| "Always allow" rule shown on the card (`allowRule`) | `_meta["nova-ai-cli/rule"]` | ✅ |
| Deny rules, private "always allow", per-segment commands | agent policy (same `rules.ts`) | ✅ |
| `nova.agent.approvalMode`: `autoReadOnly` (default) | `default` | ✅ |
| `autoAll` | `bypassPermissions` (deny still applies, never stored) | ✅ |
| `ask` (also asks for reads) | — | 🟡 decide: drop it, or add an "ask for everything" mode to the agent |
| "Approve for this session" = all tools | per tool and subject | 🟡 decide: keep the agent's narrower meaning (recommended) |
| Workspace trust = VS Code's | agent trust in `project.json` | 🟡 when VS Code trusts the workspace, the extension records it per `NOVA_HOME.md` (`"trusted": true`); no prompt twice |

### Sessions and memory

| Panel feature | ACP agent today | Status / work |
|---|---|---|
| History list, open, delete | `session/list` (paged), `session/load` (with replay), `session/delete` | ✅ |
| Session storage | agent: `projects/<key>/cli-sessions/*.jsonl` · extension: `projects/<key>/sessions/index.json` | 🔴 one-time import of extension chats into the agent's format (agent side, idempotent); `NOVA_HOME.md` then describes one format |
| Memory (`MEMORY.md` + notes), memory commands | same files and tools | ✅ (commands open the same files) |
| `nova.memory.enabled` | — | 🟡 session config option or `_meta` on `session/new` |

### Settings

| Setting | After |
|---|---|
| `nova.agent.approvalMode` | `permission_mode` config option |
| `nova.agent.maxToolRounds` | 🟡 new config option (agent default 64) |
| `nova.context.autoCompact`, `nova.context.compactThreshold`, `nova.context.defaultContextWindow` | 🟡 new config options |
| `nova.agent.commandTimeoutSeconds` | client terminal timeout |
| `nova.agent.includeMcpTools` | MCP bridge on/off |
| `nova.home` | `NOVA_AI_HOME` |
| `nova.memory.enabled` | see above |
| `nova.models.editTools`, `nova.developer.parseModelCapabilities`, `nova.chat.rewriteAssistantIdentity`, `nova.enableDiagnostics` | language-model provider / extension only: unchanged |

## The participant

`@nova` lives in VS Code's own Chat view: VS Code keeps the history, and tools
run through `vscode.lm.invokeTool` with VS Code's confirmations. On ACP it
would keep one agent session per VS Code chat (session id in
`ChatResult.metadata`), send each request as `session/prompt`, stream updates
into the chat response, and answer permission requests through VS Code's chat
confirmation UI. That last part needs a spike: which confirmation API is
stable. Alternative: retire `@nova` and point users at the panel (or at Copilot
Chat with a Nova model from the language-model provider). **Decision needed.**

## Phases

| Phase | Where | Done when |
|---|---|---|
| **A. Agent gaps** | agent package | `find_files`, `fetch_url` (approval), tool name aliases, `kind`/`front` in `queue/update`, context window in the model list, import of extension sessions, config options for rounds/compaction/memory, `readOnlyHint` for MCP; tests + `docs/ACP.md` updated; released as alpha |
| **B. ACP client in the extension** | extension | Agent process lifecycle, version check, client `fs` (documents) and `terminal`, permission and question requests into the webview, session updates → `ChatEvent`s, MCP bridge; panel runs on ACP behind a setting `nova.agent.engine: "acp" \| "builtin"` |
| **C. Panel on ACP by default** | extension | Feature table all ✅ in manual testing (incl. Windows, Remote SSH); default switched; built-in loop still selectable for one release |
| **D. Participant** | extension | Decision above implemented |
| **E. Remove the built-in agent** | extension | `agent/`, `permissions/`, `MemoryService`, `SessionStore` deleted; `docs/NOVA_HOME.md` lists one session format in both repos |

## Risks

- **Startup time** of the agent process on first message: start it in the
  background when the panel opens; measure on Windows.
- **Version skew** between extension and agent: pinned dependency plus the
  extension API version check. The agent is released separately from the
  CLI, so the extension only moves when the agent changes.
- **Feature regressions** during B/C: the `nova.agent.engine` switch allows
  falling back without a new release.
- **Two policies during the transition**: the built-in loop keeps its own
  `PermissionService` until E; both read the same rule files, so behaviour
  matches.

## Decisions for the maintainer

1. Participant: move to ACP, or retire `@nova`?
2. Approval mode `ask` (asks for reads too): drop, or add to the agent?
3. "Approve for this session": keep the agent's per-tool meaning?
4. Phase A in the next CLI alpha, before any extension work?
