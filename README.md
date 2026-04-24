# Nova AI VS Code Extension

Native Nova AI chat models for VS Code.

## Features

- Contributes Nova AI as a `languageModelChatProvider`
- Stores the API key in VS Code `SecretStorage`
- Discovers Nova models at runtime
- Streams responses through `@datalabrotterdam/nova-sdk`
- Shows onboarding and account state in a sidebar webview
- Supports tool-calling passthrough with chat-only fallback

## Commands

- `Nova AI: Manage Account`
- `Nova AI: Sign In`
- `Nova AI: Sign Out`
- `Nova AI: Refresh Models`
- `Nova AI: Open Chat`

## Settings

- `nova.baseUrl`
- `nova.defaultModel`
- `nova.enableDiagnostics`

## Development

```bash
npm install
npm run compile
npm test
```
