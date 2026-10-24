# Development

## Local Setup

```bash
npm install
npm run verify
```

| Script | Description |
|--------|-------------|
| `npm run compile` | Build webview, typecheck, bundle extension, copy the skills package |
| `npm test` | Run Vitest suite |
| `npm run package:vsix` | Build pre-release VSIX in `dist/` |
| `npm run verify` | Run tests and package VSIX |

The extension entrypoint is bundled with `esbuild` (`vscode` kept external). Runtime SDK code is bundled into `out/extension.js` — no `node_modules` in the published VSIX.

### Bundled skills

The Word, Excel, PowerPoint and PDF skills come from `@datalabrotterdam/nova-ai-skills`. Its files can't be bundled, so `compile` ends with `build:skills`, which copies the package to `out/nova-ai-skills`; the VSIX ships that folder. On activation the extension runs the package's `installSkills`, which copies the skills into `~/.nova-ai/skills` with a `.nova-bundled.json` marker (install rules: [NOVA_HOME.md](NOVA_HOME.md), "Bundled skills").

- **Run Nova AI Extension** (F5) runs `npm: compile` first, so the skills are copied. The dev host installs them into your real `~/.nova-ai`, the same as a release.
- `npm run watch` only runs `tsc`; run `compile` at least once so `out/nova-ai-skills` exists.
- After a pull that adds or bumps the package, run `npm install` before compiling: `build:skills` fails when the package is missing and copies the old version when it is outdated.

## Release Flow

CI pipeline: `test → verify → publish`

- PRs and pushes run tests and packaging checks
- Alpha releases publish from the `alpha` branch
- Semantic Release creates GitHub prereleases
- Same VSIX published to VS Code Marketplace and Open VSX

**Required GitHub Actions secrets:**

- `AZURE_DEVOPS_TOKEN`
- `OVSX_PAT`
