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
3. Select **Get Started**.
4. Enter your Nova AI API key.
5. Open VS Code Chat and choose a Nova model.

After connecting, Nova AI confirms the extension is ready.

## Using Nova AI

Open the Nova AI sidebar to manage your connection and models:

| Action                   | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| **Open Chat**      | Opens the VS Code Chat view                            |
| **Refresh Models** | Reloads the available Nova model list                  |
| **Settings**       | Opens Nova AI extension settings                       |
| **Sign Out**       | Removes the stored API key from VS Code Secret Storage |

Commands available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Nova AI: Manage Account`
- `Nova AI: Sign In`
- `Nova AI: Sign Out`
- `Nova AI: Refresh Models`
- `Nova AI: Open Chat`
- `Nova AI: Open Settings`

## Settings

| Setting                                   | Description                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `nova.enableDiagnostics`                | Enable verbose diagnostics logging in the output panel                                 |
| `nova.developer.parseModelCapabilities` | Parse Nova AI model capabilities into VS Code native flags (tool calling, image input) |

## Privacy & Security

Your API key is stored using VS Code Secret Storage — it is never written to workspace files or extension settings.

> AI can make mistakes. Review important output before relying on it.

---

For contributing and development details, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
