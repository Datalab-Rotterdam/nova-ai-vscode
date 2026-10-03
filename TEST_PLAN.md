From this repo, the fastest loop is:

1. Run npm install if you haven’t already.
2. Run npm run compile.
3. Open the folder in VS Code.
4. Press F5 to launch an Extension Development Host.
5. In the new window, open the Command Palette and run Nova AI: Manage Account.

Then test the main flows:

- Signed out:
    - Confirm the Nova AI activity bar icon appears.
    - Open the Nova AI sidebar and check that the onboarding form renders.
    - Open Chat and verify Nova models do not appear in the model picker yet.
- Sign in:
    - Use Nova AI: Sign In or the sidebar form.
    - Enter a valid Nova API key.
    - Run Nova AI: Refresh Models.
    - Open Chat and check that Nova models appear in the model picker.
- Persistence:
    - Close the Extension Development Host.
    - Press F5 again.
    - Confirm the sidebar still shows a connected state.
- Sign out:
    - Run Nova AI: Sign Out.
    - Confirm the sidebar returns to onboarding and Nova models disappear after refresh.

- Agent mode:
    - Pick a Nova model in agent mode; ask it to add a function and run the tests.
    - With nova.enableDiagnostics on, check the "Nova chat request started" trace: no empty messages, tool messages directly after their calls.
    - Ask "who are you?" — it should answer Nova, not GitHub Copilot.
    - Pick the "Nova" agent from the agent dropdown.
- @nova:
    - Attach a file with #file and ask about it; run a multi-step tool task; try /explain, /fix, /tests.
    - Ask a follow-up and confirm earlier tool results are still known.
    - Run /compact, then continue the conversation.
- Nova chat panel:
    - Ask a question about the workspace: read/search tools run without approval and show as cards.
    - Ask for a change: the edit card waits for approval; "Review changes" opens a diff; Allow applies and saves the file; Reject is reported back to the model.
    - Ask it to run the tests: the command card shows the command line; output appears in the card.
    - Stop a long run mid-stream; send another message afterwards.
    - Add files and the editor selection as context; switch models; check the context meter.
    - Reload the window: the last chat and the history are restored.
- Nova folder and memory:
    - ~/.nova-ai/projects/<name>-<hash>/ exists with project.json; earlier chats appear in history after upgrading.
    - "Remember that I prefer pnpm" shows an approval card; the entry appears in a MEMORY.md; a new chat knows it.
    - Add an AGENTS.md to the repo and check Nova follows it.
    - Ask for a throwaway experiment: files go under scratch/, not into the repo.
    - On a command approval, "Always allow" writes .nova-ai/settings.local.json (+ .gitignore); the same command then runs without asking.
    - A deny rule in .nova-ai/settings.json blocks the command.
- Context compaction:
    - Set nova.context.defaultContextWindow low (e.g. 8192) with a model that does not advertise a window, run a long @nova task, and confirm the "Compacted" progress message and no overflow error.
- Themes:
    - Check the sidebar in Light+, Dark+, High Contrast Dark/Light and one third-party theme: readable text, visible logos and focus rings.
- Stable vs Insiders:
    - In stable VS Code everything above works without proposals. In Insiders with --enable-proposed-api datalabrotterdam.nova-ai-vscode, thinking output and per-model options appear too.

Useful debugging while testing:

- Open View: Output, then choose Nova AI if you enable nova.enableDiagnostics.
- Open Help: Toggle Developer Tools in the Extension Development Host to inspect webview errors.
- If chat doesn’t open from the command, open the Chat view manually and check whether the Nova models are listed there.

For automated checks, run:

npm test

