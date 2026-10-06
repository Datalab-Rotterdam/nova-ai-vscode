<div align="center">
  <img src="../icons/icon-192-rounded.png" alt="Nova AI" width="96" height="96" />
  <h1>Nova AI Help</h1>
</div>

Nova AI brings the Nova model catalog into VS Code. You can use it in three places:

| Where | What it is | Open it |
| --- | --- | --- |
| **Nova chat** | Nova's own agent in the Nova AI sidebar (or an editor tab), with built-in tools, approvals, diffs and history | Nova AI icon in the Activity Bar, or **Nova AI: Open Nova Chat** |
| **VS Code Chat** | Nova models in VS Code's own chat and agent mode | Pick a Nova model in the chat model picker |
| **`@nova`** | Nova's chat participant inside VS Code Chat | Type `@nova` in VS Code Chat |

Open this page any time with **Nova AI: Help**, the **…** menu of the Nova AI sidebar, or `/help` in the Nova chat.

## Getting started

1. Open the Nova AI view from the Activity Bar.
2. Select **Connect Nova AI** and paste your API key. It is kept in VS Code Secret Storage, never in settings or workspace files.
3. Start typing in the Nova chat, or pick a Nova model in VS Code Chat.

The account page (**Nova AI: Account and Models**) shows the connection, quick actions and the available models with their capabilities.

---

## Nova chat

### Sending messages

- **Enter** sends, **Shift+Enter** starts a new line.
- While Nova is working you can keep typing. A message sent then is **steering**: Nova reads it at its next step. Click its label to turn it into a **queued** follow-up, sent after the reply instead. ▶ sends a waiting message now, ✕ removes it.
- The red square stops Nova. Waiting messages then stay until you send them.
- Hover over one of your messages and click the pencil to **edit and resend** it: everything after it is replaced by the new reply.

### Slash commands

Type `/` at the start of the input box for a menu: **↑/↓** to choose, **Tab** to fill in, **Enter** to run, **Esc** to close.

| Command | What it does |
| --- | --- |
| `/clear` (or `/new`) | Start a new chat. The current one stays in Chats. |
| `/compact [focus]` | Summarize the conversation to free up context. Optionally say what the summary should keep, e.g. `/compact the API design and open bugs`. |
| `/model [name]` | Without a name: list the models. With a name (or part of one): switch to that model. |
| `/rename <title>` | Rename this chat. |
| `/help` | Open this page. |

Anything else that starts with `/` (for example a path such as `/etc/hosts`) is sent as an ordinary message.

### Context

- **Attach files** with the paperclip, or the **editor selection** with the selection button. In the editor, right-click → **Add to Nova Chat** does the same.
- The ring next to the send button shows how full the model's context window is: yellow from 70%, red from 90%. Hover for the numbers.
- Long conversations are **compacted automatically** (`nova.context.autoCompact`): old tool output is shortened first, then older messages are summarized. Use `/compact` to do it yourself, for example before starting a new part of the work.
- After compaction the messages stay on screen for you, but Nova continues from the summary.

### Models

Pick the model in the input box (or with `/model`). Earlier replies keep the model that wrote them. When the new model's context window is smaller than the conversation, Nova tells you whether it will be compacted before the next request.

### Tools and approvals

Nova reads, lists, finds and searches files, checks problems, edits and creates files, runs commands and fetches web pages. MCP tools registered in VS Code are available too (`nova.agent.includeMcpTools`).

The approvals menu in the input box sets when Nova asks first (`nova.agent.approvalMode`):

| Mode | Asks before |
| --- | --- |
| Ask every time | every tool call |
| Auto-run read-only (default) | edits, commands and other tools that change something |
| Auto-run all | nothing |

On an approval card: **Allow** runs it once, **Always allow** saves a rule to `.nova-ai/settings.local.json`, **Allow all** allows every tool call in this chat, **Reject** tells Nova to try something else. Edit cards can open the proposed diff first.

### Changes: keep or undo

Every edit card shows the changed lines (⛶ opens the full diff). Above the input box a strip lists the files Nova changed in this chat. **Keep** accepts the changes, **Undo** puts a file back as it was before Nova's first edit (and deletes files Nova created). Both work per file or for all files; click a file to see its diff.

### Task lists and questions

For work with several steps Nova keeps a task list, shown as a one-line strip above the input box (click to expand, ✕ to close). When Nova needs a decision it asks a question with options, its recommendation marked. Pick one or more, type your own answer (also straight into the input box), or skip and let Nova decide.

### Chats

- The history button opens **Chats**: every chat of this workspace, grouped by date. Type to search, **↑/↓** and **Enter** to open, **F2** to rename, **Delete** to delete, **Esc** to go back. **Nova AI: Search Chats** does the same from the Command Palette.
- **Open Chat in Editor** moves the chat into an editor tab, even while Nova works. Each tab holds its own chat, so several can run side by side. A chat is open in one place only.
- Chats are kept until you delete them.

---

## VS Code Chat and `@nova`

- **Agent mode**: Nova models that support tool calling appear in agent mode and can use VS Code's tools. The **Nova** custom agent in the agent dropdown is tuned for Nova models.
- **`@nova`** works with VS Code's tools and attachments (`#file`, selections, images) and has its own commands: `/explain`, `/fix`, `/tests` and `/compact`.
- **Prompt files** `/nova-review`, `/nova-explain` and `/nova-tests` work in any chat.

---

## Memory

Nova starts every Nova chat with:

- the global `MEMORY.md`: your preferences, for every project,
- the project's `MEMORY.md`: private notes for this workspace,
- `NOVA.md` or `AGENTS.md` in your repository: team instructions, which Nova never changes.

Ask Nova to remember, update or forget something and it changes the memory after your approval. Edit the files yourself with **Nova AI: Open Global Memory** and **Nova AI: Open Project Memory**. Turn memory off with `nova.memory.enabled`.

## Skills

A skill is a folder with a `SKILL.md`: reusable instructions Nova loads when a task fits. **Nova AI: Manage Skills** opens a page with **Global** (`~/.nova-ai/skills`, every project) and **Project** (`.nova-ai/skills`, in the repository) tabs, where you create skills from a template, edit them, switch them on or off and move or delete them. Skills in `.agents`, `.claude` and `.codex` skills folders are found too.

Only the names and short descriptions of the skills that are on are sent with each request; Nova reads a skill's instructions when it uses it.

## Permission rules

Rules decide which tool calls run without asking and which never run:

- `~/.nova-ai/settings.json`: your own rules, for every project.
- `.nova-ai/settings.json` in the repository: shared with your team.
- `.nova-ai/settings.local.json`: personal and gitignored (**Always allow** writes here).

```json
{ "permissions": { "allow": ["run_command(npm test*)", "edit_file"], "deny": ["run_command(rm -rf*)"] } }
```

A rule is a tool name, optionally with a `*` pattern for the command, URL or path. Deny rules always win. Allow rules from a repository only apply in a trusted workspace.

## Where Nova keeps its data

Everything lives in `~/.nova-ai` (change it with `nova.home` or `NOVA_AI_HOME`): global memory and rules, skills, and one folder per workspace with its memory, chat history and a scratch folder for throwaway files. **Nova AI: Reveal Nova Folder** opens it; **Nova AI: Clean Up Projects** removes the data of workspaces that no longer exist.

---

## Commands

| Command | |
| --- | --- |
| Nova AI: Open Nova Chat | Show the Nova chat |
| Nova AI: New Chat | Start a new Nova chat |
| Nova AI: Open Chat in Editor | Move the chat into an editor tab |
| Nova AI: Chats / Search Chats | Find, open, rename or delete chats |
| Add to Nova Chat | Attach the editor selection |
| Nova AI: Manage Skills | Create and manage skills |
| Nova AI: Open Global Memory / Open Project Memory | Edit Nova's memory |
| Nova AI: Reveal Nova Folder | Open `~/.nova-ai` |
| Nova AI: Clean Up Projects | Remove data of workspaces that are gone |
| Nova AI: Account and Models / Manage Account | Connection and models |
| Nova AI: Refresh Models | Reload the model list |
| Nova AI: Manage Language Models | VS Code's model management |
| Nova AI: Sign In / Sign Out | Connect or disconnect your API key |
| Nova AI: Open Chat | Open VS Code Chat |
| Nova AI: Open Settings | Nova AI settings |
| Nova AI: Help | This page |

## Settings

| Setting | Default | |
| --- | --- | --- |
| `nova.agent.approvalMode` | `autoReadOnly` | When the Nova chat asks before running tools |
| `nova.agent.maxToolRounds` | 25 | Tool rounds per request before Nova pauses |
| `nova.agent.commandTimeoutSeconds` | 120 | Time limit for commands the Nova chat runs |
| `nova.agent.includeMcpTools` | on | Offer MCP tools to the Nova chat |
| `nova.context.autoCompact` | on | Compact long conversations automatically |
| `nova.context.compactThreshold` | 0.8 | Share of the context window at which to compact |
| `nova.context.defaultContextWindow` | 32768 | Context window for models that do not advertise one |
| `nova.memory.enabled` | on | Use and update Nova's memory |
| `nova.home` | `~/.nova-ai` | Folder for memory, chats, skills and scratch files |
| `nova.chat.rewriteAssistantIdentity` | on | Present Nova (not Copilot) when a Nova model runs in VS Code Chat |
| `nova.models.editTools` | find/replace | Edit tools agent mode offers Nova models |
| `nova.enableDiagnostics` | off | Verbose logging in the Nova AI output channel |

## Troubleshooting

- **No models**: check the connection on the account page, then **Nova AI: Refresh Models**.
- **"Stopped after 25 tool rounds"**: send `continue`, or raise `nova.agent.maxToolRounds`.
- **The conversation no longer fits**: use `/compact`, switch to a model with a larger context window, or start over with `/clear`.
- **Something else**: turn on `nova.enableDiagnostics` and look at the **Nova AI** output channel.

> AI can make mistakes. Review important output before relying on it.

---

<div align="center">
  <img src="../datalab-logo.svg#gh-dark-mode-only" alt="DataLab Rotterdam" width="180" />
  <img src="../datalab-logo-on-light.svg#gh-light-mode-only" alt="DataLab Rotterdam" width="180" />
  <p><sub>Nova AI is made by DataLab Rotterdam · <a href="https://docs.datalabrotterdam.nl/services/nova-ai">Documentation</a></sub></p>
</div>
