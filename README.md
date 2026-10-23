<div align="center">
  <img src="https://raw.githubusercontent.com/Datalab-Rotterdam/nova-ai-vscode/refs/heads/main/resources/icons/icon-192-rounded.png" alt="Nova AI" width="96" height="96" />
  <h1>Nova AI for Visual Studio Code</h1>
  <p>Use Nova AI models directly in the Visual Studio Code Chat experience.</p>

  [![VS Code Marketplace](https://vsmarketplacebadges.dev/version/datalabrotterdam.nova-ai-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=datalabrotterdam.nova-ai-vscode)
  [![Open VSX](https://img.shields.io/open-vsx/v/datalabrotterdam/nova-ai-vscode?label=Open%20VSX)](https://open-vsx.org/extension/datalabrotterdam/nova-ai-vscode)
  [![License](https://img.shields.io/github/license/Datalab-Rotterdam/nova-ai-vscode)](LICENSE)

</div>

---

Nova AI brings the Nova model catalog into VS Code. Chat with an AI agent that reads your project, edits files, runs commands and searches the web, and stays in your control: every change can be reviewed, kept or undone.

## Requirements

- Visual Studio Code with Chat support
- A Nova AI API key. Need access? See the [Nova AI documentation](https://docs.datalabrotterdam.nl/services/nova-ai).

## Getting started

1. Install the **Nova AI** extension.
2. Open the Nova AI view from the Activity Bar.
3. Select **Connect Nova AI** and paste your API key. It is stored in VS Code Secret Storage, never in files or settings.
4. Start typing in the Nova chat. You can also pick a Nova model in VS Code Chat, or type `@nova`.

Stuck or curious? Run **Nova AI: Help** for a full guide inside VS Code.

## Three ways to use Nova

| Where | What it is |
| --- | --- |
| **Nova chat** (sidebar or editor tab) | Nova's own agent: built-in tools, approvals, diffs, history, memory and skills. The main experience. |
| **VS Code Chat** | Nova models in VS Code's chat model picker and agent mode. |
| **`@nova`** | Nova's chat participant inside VS Code Chat, with `/explain`, `/fix`, `/tests` and `/compact`. |

## What the Nova chat can do

### Work on your code

- **Read, search and edit**: find files, check problems, edit and create files, run commands, fetch web pages and use MCP tools registered in VS Code.
- **Connect MCP servers**: add servers to `~/.nova-ai/mcp.json` or the workspace's `.mcp.json` / `.nova-ai/mcp.json` (Claude's format; stdio, HTTP and SSE). **Nova AI: MCP Servers** shows their status and signs you in to servers that use OAuth. Allow a whole server with a rule such as `mcp__github__*`.
- **Review every change**: edit cards show the changed lines. A strip above the input lists the files Nova touched, with **Keep** and **Undo** per file or for all.
- **Stay in control**: choose how often Nova asks first with the permissions menu under the input (see [Modes](#modes-and-permissions)).
- **Search the web**: Nova looks up current information and cites its sources. No API key needed.
- **Use your browser**: with the Nova AI Browser integration Nova can open pages and take screenshots in Chrome, Edge or Brave. Set it up with **Nova AI: Set Up Browser Integration** (it runs automatically on startup by default).
- **Research in parallel**: for broad questions Nova can start up to a few research sub-agents. A strip above the input shows each one live; click an agent to watch what it does, or stop it.
- **Git**: `/commit` writes the commit message for your staged changes in the style of your history (you confirm it first), `/review` reviews the branch against its base and reports findings by severity, and `/pr` pushes the branch and opens a pull request (written by Nova with the GitHub CLI, or your Git host's page for a new pull or merge request).
- **Plan multi-step work**: Nova keeps a task list above the input and asks you questions with options when it needs a decision.

### Modes and permissions

Two small menus under the input box:

| Agent mode | For |
| --- | --- |
| **Interactive** | Normal back-and-forth work (default) |
| **Plan** | Researches and writes a plan; read-only, changes nothing |
| **Ask** | Answers questions about your code; read-only |
| **Autopilot** | Works on its own until the task is done, within your permissions |

Press **Shift+Tab** to cycle through the agents. Create your own with **Nova AI: Manage Agents**.

| Permissions | Nova asks before |
| --- | --- |
| **Manual** | every edit and command |
| **Assisted** (default) | anything that changes something, unless a rule allows it |
| **Allow all** | nothing |

On an approval card choose **Allow**, **Always allow** (saves a rule), **Allow all** for the chat, or **Reject**.

### Give it context

- Type **`@`** to mention a workspace file.
- Use the **paperclip**, or **paste and drop** files and images (also from the Explorer; hold **Shift** while dropping from VS Code). Click an image to enlarge it.
- Right-click in the editor and choose **Add to Nova Chat** to send your selection.
- The ring next to Send shows how full the model's context window is; click it for details and a **Compact** button. Long chats are compacted automatically.

### Chat comfortably

- **Enter** sends, **Shift+Enter** adds a line. Keep typing while Nova works to **steer** it, or queue a follow-up.
- Edit and resend an earlier message, or regenerate an answer and keep both versions.
- Replies render Markdown, code, links (checked before they open) and LaTeX math, with copy buttons.
- Thinking and tool calls fold into short, readable steps.
- Type **`/`** for quick commands: `/clear`, `/compact`, `/model`, `/rename`, `/commit`, `/review`, `/pr`, `/help`.
- **Chats** (history button) lists every chat of the workspace with search, rename and delete. **Open Chat in Editor** moves a chat to its own tab, so several can run side by side.

### Make Nova yours

- **Memory**: Nova remembers your preferences (global) and notes about the project, and reads `NOVA.md` or `AGENTS.md` in your repository for team instructions. It asks before changing memory.
- **Skills**: reusable instructions (a folder with `SKILL.md`) that Nova loads when a task fits. Manage them with **Nova AI: Manage Skills**, globally or per project.
- **Agents**: custom agent modes as markdown files, global or per project.
- **Permission rules**: shared or personal allow/deny rules, in `.nova-ai/settings.json` and `.nova-ai/settings.local.json`:

  ```json
  { "permissions": { "allow": ["run_command(npm test*)", "edit_file"], "deny": ["run_command(rm -rf*)"] } }
  ```

  A rule is a tool name, optionally with a `*` pattern. Deny always wins. Rules from a repository apply only in a trusted workspace.
- **Hooks**: run your own commands before or after a tool, when you send a message or when Nova wants to stop, in Claude Code's format (hooks copied from `.claude/settings.json` work, matchers such as `Bash` or `Edit|Write` included). Exit code 2 blocks with a reason for Nova; a `Stop` hook can keep Nova working until your tests pass:

  ```json
  { "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "npm test --silent || exit 2" }] }] } }
  ```

  Hooks go in the same settings files as the rules; a repository's hooks run only in a trusted workspace. Details in [docs/NOVA_HOME.md](docs/NOVA_HOME.md#hooks).

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **Nova AI**:

| Command | What it does |
| --- | --- |
| Open Nova Chat / New Chat / Open Chat in Editor | Show, start or move a chat |
| Chats / Search Chats | Find, open, rename or delete chats |
| Add to Nova Chat | Send the editor selection (also in the editor context menu) |
| Manage Skills / Manage Agents | Create and manage skills and agent modes |
| MCP Servers | Status of your MCP servers; connect (sign in), reconnect, turn off |
| Open Global Memory / Open Project Memory | Edit Nova's memory |
| Set Up Browser Integration | Let Nova use your browser |
| Account and Models / Manage Account / Refresh Models | Connection and model list |
| Sign In / Sign Out | Connect or disconnect your API key |
| Reveal Nova Folder / Clean Up Projects | Open `~/.nova-ai`, remove data of deleted workspaces |
| Manage Language Models / Open Chat / Open Settings | VS Code integration |
| Help | The full in-editor guide |

## Settings

Search for **Nova** in VS Code Settings. The ones you are most likely to want:

| Setting | Default | What it does |
| --- | --- | --- |
| `nova.agent.approvalMode` | `autoReadOnly` | When Nova asks before running tools (`ask`, `autoReadOnly`, `autoAll`) |
| `nova.agent.maxToolRounds` | 25 | Tool rounds per request before Nova pauses |
| `nova.agent.commandTimeoutSeconds` | 120 | Time limit for commands Nova runs |
| `nova.mcp.enabled` | on | Connect the servers in `mcp.json` (workspace servers only when trusted) |
| `nova.mcp.toolTimeoutSeconds` | 60 | Time limit for one MCP tool call |
| `nova.agent.includeMcpTools` | on | Also offer MCP tools registered in VS Code |
| `nova.agent.subagents.*` | on | Research sub-agents: on/off, model, and limits on how many run |
| `nova.webSearch.*` | on | Web search providers (DuckDuckGo, You.com, your own SearXNG) |
| `nova.browser.autoSetup` | on | Set up the browser integration on startup |
| `nova.context.autoCompact` | on | Compact long conversations automatically |
| `nova.context.compactThreshold` | 0.8 | Share of the context window at which `@nova` compacts |
| `nova.context.defaultContextWindow` | 32768 | Context window for models that do not advertise one |
| `nova.memory.enabled` | on | Use and update Nova's memory |
| `nova.home` | `~/.nova-ai` | Where memory, chats, skills and scratch files live |

Developer settings (`nova.chat.rewriteAssistantIdentity`, `nova.models.editTools`, `nova.developer.parseModelCapabilities`, `nova.enableDiagnostics`) are in the **Developer Settings** group.

Some integrations (thinking output, per-model options in the model picker) use VS Code API proposals. They work where VS Code enables them and are skipped otherwise.

## Where your data lives

Nova keeps its data in `~/.nova-ai`, readable only by you:

```
~/.nova-ai/
  MEMORY.md                  global memory
  skills/  agents/           your global skills and agents
  settings.json              your own permission rules
  mcp.json                   your MCP servers
  projects/<name>-<hash>/    per workspace: memory, chat history, scratch files
```

A repository can also hold a `.nova-ai/` folder (rules, skills, agents) and a `NOVA.md` / `AGENTS.md` with team instructions. The `nova-ai` terminal app shares this folder, so memory, skills and chats carry over. The layout is documented in [docs/NOVA_HOME.md](docs/NOVA_HOME.md).

## Troubleshooting

- **No models**: check the connection in the Nova AI view, then run **Nova AI: Refresh Models**.
- **"Stopped after 25 tool rounds"**: send `continue`, or raise `nova.agent.maxToolRounds`.
- **Conversation no longer fits**: use `/compact`, pick a model with a larger context window, or start over with `/clear`.
- **Something else**: turn on `nova.enableDiagnostics` and read the **Nova AI** output channel.

## Privacy & security

Your API key lives in VS Code Secret Storage. Nova data files are created readable only by you. Links in replies are never opened without showing you where they go.

> AI can make mistakes. Review important output before relying on it.

---

For contributing and development details, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
