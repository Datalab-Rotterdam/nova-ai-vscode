# Development

## Local Setup

```bash
npm install
npm run verify
```

| Script | Description |
|--------|-------------|
| `npm run compile` | Build webview, typecheck, bundle extension |
| `npm test` | Run Vitest suite |
| `npm run package:vsix` | Build pre-release VSIX in `dist/` |
| `npm run verify` | Run tests and package VSIX |

The extension entrypoint is bundled with `esbuild` (`vscode` kept external). Runtime SDK code is bundled into `out/extension.js` — no `node_modules` in the published VSIX.

## Release Flow

CI pipeline: `test → verify → publish`

- PRs and pushes run tests and packaging checks
- Alpha releases publish from the `alpha` branch
- Semantic Release creates GitHub prereleases
- Same VSIX published to VS Code Marketplace and Open VSX

**Required GitHub Actions secrets:**

- `AZURE_DEVOPS_TOKEN`
- `OVSX_PAT`
