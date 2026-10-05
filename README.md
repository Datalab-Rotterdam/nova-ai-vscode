<div align="center">
  <img src="https://raw.githubusercontent.com/Datalab-Rotterdam/nova-ai-vscode/refs/heads/main/resources/icons/icon-192-rounded.png" alt="Nova AI" width="96" height="96" />
  <h1>Nova AI for Visual Studio Code</h1>
  <p>Use Nova AI models directly in the Visual Studio Code Chat experience.</p>

  [![VS Code Marketplace](https://vsmarketplacebadges.dev/version/datalabrotterdam.nova-ai-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=datalabrotterdam.nova-ai-vscode)
  [![Open VSX](https://img.shields.io/open-vsx/v/datalabrotterdam/nova-ai-vscode?label=Open%20VSX)](https://open-vsx.org/extension/datalabrotterdam/nova-ai-vscode)
  [![License](https://img.shields.io/github/license/Datalab-Rotterdam/nova-ai-vscode)](LICENSE)

</div>

---

Nova AI connects VS Code to the Nova model catalog, stores your API key in VS Code Secret Storage, and lets you use available Nova chat models from the editor.

## Requirements

- Visual Studio Code with Chat support
- A Nova AI API key

Need access or setup details? See the [Nova AI documentation](https://docs.datalabrotterdam.nl/services/nova-ai).

## Getting Started

1. Install the **Nova AI** extension.
2. Open the Nova AI view from the Activity Bar.
3. Select **Connect Nova AI** and paste your API key.
4. Open VS Code Chat and pick a Nova model, or type `@nova`.

## Using Nova AI

- **Agent mode**: pick a Nova model in the chat model picker. Nova models that support tool calling show up in agent mode and can edit files and run tools. The **Nova** custom agent in the agent dropdown is tuned for Nova models.
- **`@nova`**: Nova's own chat participant with full VS Code tool support, attachments (`#file`, selections, images) and slash commands:
  `/explain`, `/fix`, `/tests` and `/compact` (summarize the conversation to free up context).
- **Prompt files**: `/nova-review`, `/nova-explain` and `/nova-tests` work in any chat.
- **Nova chat panel** (the Nova AI sidebar): Nova's own agent with built-in tools — read, list, find and search files, check problems, edit and create files, and run commands. Edits and commands wait for your approval (with a diff preview); read-only tools run automatically by default. Add files or the editor selection as context (**Add to Nova Chat** in the editor context menu), switch models and follow context usage. MCP tools registered in VS Code are available too.
- **Chats**: the history button opens a list of every chat of the workspace over the conversation, grouped by Today, Yesterday, the last 7 and 30 days and per month. Type to search, **↑/↓** and **Enter** to open, **F2** or the pencil to rename, the trash icon (or **Delete**) to delete a chat or a whole group, **Esc** to go back. **Nova AI: Search Chats** does the same from the command palette. Chats are kept until you delete them.
- **Chats in editor tabs**: the sidebar shows one chat at a time; **Open Chat in Editor** moves it into an editor tab (even while Nova is working) and every tab holds a chat of its own, so several chats can be open and running side by side. Tabs are named after the chat (its first question, or the name you gave it) and come back after a reload. In a tab, **+** opens a new chat in another tab. On the Chats page, right-click a chat (or use the ↗ button) to open it in the editor. A chat is open in one place only: opening it again shows the tab that has it.
- **Skills**: reusable instructions (a folder with a `SKILL.md`) that Nova loads when a task fits. **Nova AI: Manage Skills** (also in the Nova sidebar's **…** menu) opens a page like Settings, with **Global** (every project, `~/.nova-ai/skills`) and **Project** (`.nova-ai/skills` in the repository) tabs: create from a template, edit, switch on or off (also a global skill for this project only), move between global and project, and delete. Skills in `.agents`, `.claude` and `.codex` skills folders are found too. To save context, only the names and short descriptions of the skills that are on go into each request, within a fixed budget; Nova reads a skill's instructions only when it uses it. The terminal app (`nova-ai`) uses the same skills and switches.
- **Diffs** (Nova chat): every edit card shows the changed lines inline (expand to see more, ⛶ to open the full diff editor). Above the input box a strip lists the files Nova changed in this chat with **Keep** / **Undo** per file or for all, and opens each file's diff against its content before Nova's first edit.
- **Task lists and questions** (Nova chat): for multi-step work Nova keeps a task list, shown as a one-line strip above the input box (click to expand, ✕ to close). When it needs a decision it asks a question with options (a recommended one and a short explanation each), multiple choice, or your own answer; you can also just type the answer, or skip and let Nova decide.
- **Account view**: connection status, quick actions and the available models with their capabilities. Refresh, settings, model management and sign-out live in the view's title bar.

Long conversations are compacted automatically to fit each model's context window.

Commands available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Nova AI: Manage Account`
- `Nova AI: Sign In`
- `Nova AI: Sign Out`
- `Nova AI: Refresh Models`
- `Nova AI: Open Chat`
- `Nova AI: Open Nova Chat`
- `Nova AI: New Chat`
- `Add to Nova Chat`
- `Nova AI: Open Chat in Editor`
- `Nova AI: Open Global Memory` / `Nova AI: Open Project Memory`
- `Nova AI: Reveal Nova Folder`
- `Nova AI: Clean Up Projects` (removes data of workspaces that no longer exist)
- `Nova AI: Manage Language Models`
- `Nova AI: Open Settings`

## Memory, chats and permissions

Nova keeps its data in a folder in your home directory, `~/.nova-ai` (change it with `nova.home` or `NOVA_AI_HOME`):

```
~/.nova-ai/
  MEMORY.md                        global memory: your preferences, for every project
  settings.json                    your own permission rules (optional)
  projects/<name>-<hash>/          one folder per workspace
    project.json                   which workspace this folder belongs to
    MEMORY.md                      private memory for this project
    sessions/                      Nova chat history
    scratch/                       sandbox for throwaway files (cleaned after 7 days)
```

- **Memory**: Nova reads the global `MEMORY.md`, the project's `MEMORY.md`, and a `NOVA.md` or `AGENTS.md` in your repository (team instructions, never changed by Nova) at the start of every chat. Ask Nova to remember, update or forget something and it changes the memory after your approval, showing the change as a diff. When a memory file grows long, Nova offers to consolidate it. Edit the files any time: **Nova AI: Open Global Memory** / **Open Project Memory**.
- **Workspace settings**: a `.nova-ai/` folder in your repository can hold permission rules, like Claude Code's `.claude/`:
  - `.nova-ai/settings.json`: shared with your team and committed.
  - `.nova-ai/settings.local.json`: personal and gitignored. **Always allow** on an approval card adds rules here.

  ```json
  { "permissions": { "allow": ["run_command(npm test*)", "edit_file"], "deny": ["run_command(rm -rf*)"] } }
  ```

  A rule is a tool name, optionally with a `*` pattern for the command, URL or path. Deny rules always win. Allow rules from a repository only apply in a trusted workspace.
- Chat history from earlier versions is moved here automatically. Files are created readable only by you.

## Settings

| Setting | Description |
| --- | --- |
| `nova.chat.rewriteAssistantIdentity` | Replace VS Code Chat's built-in assistant identity with Nova's when a Nova model is used (default: on) |
| `nova.models.editTools` | Edit tools agent mode offers Nova models (default: find/replace) |
| `nova.context.defaultContextWindow` | Context window assumed for models that do not advertise one (default: 32768) |
| `nova.context.autoCompact` | Compact long conversations automatically (default: on) |
| `nova.context.compactThreshold` | Share of the input budget at which `@nova` compacts (default: 0.8) |
| `nova.agent.maxToolRounds` | Maximum tool rounds per request in `@nova` and the Nova chat (default: 25) |
| `nova.agent.approvalMode` | When the Nova chat asks before running tools: `ask`, `autoReadOnly` (default) or `autoAll` |
| `nova.agent.commandTimeoutSeconds` | Time limit for commands run by the Nova chat (default: 120) |
| `nova.agent.includeMcpTools` | Offer MCP tools registered in VS Code to the Nova chat (default: on) |
| `nova.home` | Folder for Nova's memory, chats and scratch files (default `~/.nova-ai`) |
| `nova.memory.enabled` | Use and update Nova's memory (default: on) |
| `nova.enableDiagnostics` | Verbose diagnostics in the Nova AI output channel |
| `nova.developer.parseModelCapabilities` | Parse Nova model capabilities into VS Code flags (tool calling, image input) |

Some integrations (thinking output, edit-tool hints, per-model options and pricing in the model picker) use VS Code API proposals. They are active where VS Code enables them and are skipped otherwise.

## Privacy & Security

Your API key is stored using VS Code Secret Storage — it is never written to workspace files or extension settings.

> AI can make mistakes. Review important output before relying on it.

---

For contributing and development details, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

