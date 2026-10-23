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
- **Attach by paste or drop:** paste (Cmd/Ctrl+V) or drop images and text files on the Nova chat box, from your computer or from the VS Code Explorer and editor tabs (hold **Shift** while dropping from VS Code). PNG, JPEG and WebP images are sent as images; text files are sent as text. Files outside the workspace are sent inline, up to 60,000 characters. **Any other file** (PDF, Word, Excel, PowerPoint, archives, … up to 50 MB) is saved for Nova and opened by Nova itself with its tools, in an agent that can run commands. The bundled skills **nova-pdf**, **nova-docx**, **nova-xlsx** and **nova-pptx** let Nova read, create and edit these files, including comments and notes (read, reply, resolve), tracked changes (Word), metadata, and a diff between two versions. Reading needs only Python 3; creating and editing install `openpyxl`, `python-docx`, `python-pptx`, `pypdf` or `reportlab` into Nova's own environment (`~/.nova-ai/python-env`, never your system Python) the first time, after you approve the command.
- **Images:** Nova can look at images in your workspace and at the screenshots it takes in your browser (Nova AI Browser), with a model that reads images (shown on the account page). Other models only learn that there is an image.
- **Links** in replies: hover to see where a link goes. Web and email links ask first and show the full address (with a warning when the link text names another site or the link is not secure); you can open it in your browser or copy it. Links to files open them in the editor. Other kinds of links (`command:`, `file:`, `vscode:`, …) are never opened.

### Slash commands

Type `/` at the start of the input box for a menu: **↑/↓** to choose, **Tab** to fill in, **Enter** to run, **Esc** to close.

| Command | What it does |
| --- | --- |
| `/clear` (or `/new`) | Start a new chat. The current one stays in Chats. |
| `/compact [focus]` | Summarize the conversation to free up context. Optionally say what the summary should keep, e.g. `/compact the API design and open bugs`. |
| `/model [name]` | Without a name: list the models. With a name (or part of one): switch to that model. |
| `/rename <title>` | Rename this chat. |
| `/commit [note]` | Commit the staged changes with a message Nova writes from the diff (in the style of your recent commits). Nothing staged? Nova offers to stage everything. You confirm or edit the subject before anything is committed. |
| `/review [base]` | Review the changes on this branch against its base branch (default: origin's default branch), committed and uncommitted. Nova reads the surrounding code and reports findings by severity; it edits nothing. |
| `/pr [note]` (or `/mr`) | Push the branch and open a pull request. With the GitHub CLI (`gh`) or GitLab CLI (`glab`) Nova writes the title and description and creates the pull or merge request after you confirm; otherwise it opens your Git host's page for a new one. Self-hosted hosts use the CLI you are logged in to there. On the default branch it first asks for a new branch name. |
| `/help` | Open this page. |

Anything else that starts with `/` (for example a path such as `/etc/hosts`) is sent as an ordinary message.

### Context

- Type **`@`** to mention a workspace file. Use the **paperclip** to attach files and images, or the **editor selection** with the selection button. In the editor, right-click → **Add to Nova Chat** does the same.
- The ring next to the send button shows how full the model's context window is: yellow from 70%, red from 90%. Click it for the numbers and a **Compact** button.
- Long conversations are **compacted automatically** (`nova.context.autoCompact`): old tool output is shortened first, then older messages are summarized. Use `/compact` to do it yourself, for example before starting a new part of the work.
- After compaction the messages stay on screen for you, but Nova continues from the summary.

### Models

Pick the model in the input box (or with `/model`). Earlier replies keep the model that wrote them. When the new model's context window is smaller than the conversation, Nova tells you whether it will be compacted before the next request.

### Tools and approvals

Nova reads, lists, finds and searches files, checks problems, edits and creates files, runs commands, searches the web and fetches web pages. MCP tools registered in VS Code are available too (`nova.agent.includeMcpTools`).

Two menus under the input box set how Nova works.

**Agent mode** (press **Shift+Tab** to cycle):

| Mode | What it does |
| --- | --- |
| Interactive | Normal work (default) |
| Plan | Researches the code and writes a plan. Read-only: it cannot edit files or run commands. |
| Ask | Answers questions about your code. Read-only. |
| Autopilot | Works on its own until the task is done and answers its own questions, still within your permissions. |

Create your own modes with **Nova AI: Manage Agents** (markdown files in `~/.nova-ai/agents` or `.nova-ai/agents`).

**Permissions** (`nova.agent.approvalMode`) set when Nova asks first:

| Mode | Asks before |
| --- | --- |
| Manual permissions | every tool call that edits or runs something |
| Assisted permissions (default) | edits, commands and other tools that change something, unless a rule allows it |
| Allow all | nothing |

Both menus show only their icon when the input box is too narrow for the labels.

On an approval card: **Allow** runs it once, **Always allow** saves a rule to `.nova-ai/settings.local.json`, **Allow all** allows every tool call in this chat, **Reject** tells Nova to try something else. Edit cards can open the proposed diff first.

### Research sub-agents

For broad questions Nova can start research sub-agents that explore the project in parallel. A strip above the input shows each agent (state, tool calls, tokens, time). Click an agent to watch what it does, or stop it with its stop button. Turn them off or limit them with `nova.agent.subagents.*`.

### Coding agents in the background

Ask Nova to make a change "in the background", or several independent changes at once, and it starts coding agents (you approve each start). Every agent works on its own branch (`nova/<name>-…`) in a separate git worktree in `~/.nova-ai/projects/<project>/worktrees`, so your own checkout and the chat stay free while it works.

- **While it works**: the agent strip shows it with its branch; click it to watch its steps, or stop it. Its file edits need no approval (they only touch its worktree); commands follow your permissions as usual.
- **When it is done**: Nova commits its work on the branch and notifies you. **Review Changes** shows every changed file next to how it was; **Merge** merges the branch into your current branch (refused while you have uncommitted changes; a conflicting merge is undone so you can merge by hand); **Discard** deletes the branch and worktree. You can also open the worktree in a new window from the agent's details.
- **Good to know**: a worktree has no installed dependencies, so the agent installs them when it needs to build or test. Closing the chat or reloading the window interrupts running agents; their branch and worktree stay, ready to review, merge or discard.

Turn them off or tune them with `nova.agent.codingAgents.*` (default: two at a time, more wait in a queue).

### Web search and browser

Nova can search the web without an API key (`nova.webSearch.*`; add your own SearXNG server if you like) and cites what it finds. With the Nova AI Browser integration (**Nova AI: Set Up Browser Integration**, on by default through `nova.browser.autoSetup`) it can also open pages and take screenshots in Chrome, Edge or Brave.

### Reading answers

Thinking and tool calls fold into short steps you can expand. Replies render Markdown, code and LaTeX math, each with a copy button. **Regenerate** an answer to keep both versions and switch between them.

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
| Nova AI: Manage Skills / Manage Agents | Create and manage skills and agent modes |
| Nova AI: Set Up Browser Integration | Let Nova use your browser |
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
| `nova.agent.subagents.*` | on | Research sub-agents: on/off, model and limits |
| `nova.agent.codingAgents.*` | on | Background coding agents: on/off, how many at once, round limit |
| `nova.webSearch.*` | on | Web search providers |
| `nova.browser.autoSetup` | on | Set up the browser integration on startup |
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
