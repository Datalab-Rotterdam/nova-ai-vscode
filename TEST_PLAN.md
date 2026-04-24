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

Useful debugging while testing:

- Open View: Output, then choose Nova AI if you enable nova.enableDiagnostics.
- Open Help: Toggle Developer Tools in the Extension Development Host to inspect webview errors.
- If chat doesn’t open from the command, open the Chat view manually and check whether the Nova models are listed there.

For automated checks, run:

npm test

If you want, I can also give you a short “happy path” checklist specifically for validating the LM provider inside the Chat model picker.
