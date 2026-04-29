# Nova AI for Visual Studio Code

Use Nova AI models directly in the Visual Studio Code Chat experience.

Nova AI connects VS Code to the Nova model catalog, stores your API key in VS Code Secret Storage, and lets you use available Nova chat models from the editor.

## Requirements

- Visual Studio Code with Chat support.
- A Nova AI API key.

Need access or setup details? See the [Nova AI documentation](https://docs.datalabrotterdam.nl/services/nova-ai).

## Getting Started

1. Install the **Nova AI** extension.
2. Open the Nova AI view from the Activity Bar.
3. Select **Get Started**.
4. Enter your Nova AI API key.
5. Open VS Code Chat and choose a Nova model.

After connecting, Nova AI will confirm that the extension is ready.

## Using Nova AI

Open the Nova AI sidebar to manage your connection and models:

- **Open Chat** opens the VS Code Chat view.
- **Refresh Models** reloads the available Nova model list.
- **Settings** opens the Nova AI extension settings.
- **Sign Out** removes the stored API key from VS Code Secret Storage.

You can also use these commands from the Command Palette:

- `Nova AI: Manage Account`
- `Nova AI: Sign In`
- `Nova AI: Sign Out`
- `Nova AI: Refresh Models`
- `Nova AI: Open Chat`
- `Nova AI: Open Settings`

## Settings

- `nova.enableDiagnostics`: Enable verbose Nova AI diagnostics logging in the output panel.
- `nova.developer.parseModelCapabilities`: Parse capabilities returned by Nova AI into VS Code native model capability flags such as tool calling and image input.

## Privacy and Security

Your API key is stored using VS Code Secret Storage. It is not written to workspace files or extension settings.

AI can make mistakes. Review important output before relying on it.

<details>
<summary>Development</summary>

## Local Development

Install dependencies:

```bash
npm install
```

Run the full local verification chain:

```bash
npm run verify
```

Useful scripts:

- `npm run compile`: Build the webview, typecheck the extension, and bundle the extension entrypoint.
- `npm test`: Run the Vitest suite.
- `npm run package:vsix`: Build a pre-release VSIX in `dist/`.
- `npm run verify`: Run tests and package the VSIX.

The extension entrypoint is bundled with `esbuild`, with `vscode` kept external. Runtime SDK code is bundled into `out/extension.js`, so the published VSIX does not need `node_modules`.

## Release Flow

CI runs `test -> verify -> publish`.

- Pushes and pull requests run tests and packaging checks.
- Alpha releases publish from the `alpha` branch.
- Semantic Release creates GitHub prereleases.
- The same VSIX is published to the VS Code Marketplace and Open VSX.

Required GitHub Actions secrets:

- `AZURE_DEVOPS_TOKEN`
- `OVSX_PAT`

</details>
