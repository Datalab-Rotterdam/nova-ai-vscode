import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Diagnostics } from '../core/diagnostics';

/*
 * Browser integration, set up the way Claude Code does it for its Chrome extension: this
 * extension ships the Nova AI Browser host (resources/browser-host, vendored from
 * nova-ai-browser) and registers it on startup. The host's own installer copies itself to
 * ~/.nova-ai-browser/host/<version>/, writes a wrapper and the browsers' native messaging
 * manifests, and installs the nova-browser skill into Nova's skills folder. It changes nothing
 * when everything is current and never replaces a newer host (nova-ai-cli ships one too).
 */

export const COMMAND_SET_UP_BROWSER = 'nova.setUpBrowser';
const SETTING = 'browser.autoSetup';
const NOTICE_DISMISSED = 'nova.browser.restartNoticeDismissed';

export interface BrowserSetupResult {
    version: string;
    usedThisVersion: boolean;
    changed: boolean;
    browsers: string[];
    /** Browsers registered for the first time: they read the registration after a restart. */
    newBrowsers: string[];
    node: string;
    skills: string[];
}

export type ExecFile = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<string>;

const execFileText: ExecFile = (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
            reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`));
        } else {
            resolve(stdout);
        }
    });
});

/** The installer prints one JSON line; anything before it (warnings) is ignored. */
export function parseSetupOutput(output: string): BrowserSetupResult {
    const line = output.trim().split('\n').reverse().find((entry) => entry.trim().startsWith('{'));
    if (!line) {
        throw new Error('The browser host installer printed no result.');
    }
    return JSON.parse(line) as BrowserSetupResult;
}

/**
 * Runs the bundled installer with VS Code's own runtime as Node. The installer prefers a
 * system Node for the browser wrapper when there is one.
 */
export async function runBrowserSetup(extensionPath: string, novaHome: string | undefined, run: ExecFile = execFileText): Promise<BrowserSetupResult> {
    const cli = path.join(extensionPath, 'resources', 'browser-host', 'dist', 'cli.js');
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (novaHome) {
        // The skill goes into the same Nova home this extension reads skills from.
        env.NOVA_AI_HOME = novaHome;
    }
    return parseSetupOutput(await run(process.execPath, [cli, 'install', '--auto', '--json'], { env, timeout: 60_000 }));
}

function describeResult(result: BrowserSetupResult): string {
    if (!result.browsers.length) {
        return 'Nova AI found no Chromium-based browser (Chrome, Edge, Brave, …) for the current user.';
    }
    return `Nova AI Browser host ${result.version} is set up for ${result.browsers.join(', ')}. Nova can use your browser through the nova-browser skill once the Nova AI browser extension is installed.`;
}

export function registerBrowserSetup(context: vscode.ExtensionContext, diagnostics: Diagnostics, novaHome: () => string | undefined): vscode.Disposable {
    const setUp = async (interactive: boolean): Promise<void> => {
        try {
            const result = await runBrowserSetup(context.extensionPath, novaHome());
            diagnostics.info('Browser integration checked.', result);
            if (interactive) {
                const restart = result.newBrowsers.length ? ` Restart ${result.newBrowsers.join(', ')} once so it picks this up.` : '';
                void vscode.window.showInformationMessage(`${describeResult(result)}${restart}`);
                return;
            }
            if (result.newBrowsers.length && !context.globalState.get<boolean>(NOTICE_DISMISSED)) {
                const choice = await vscode.window.showInformationMessage(
                    `Nova AI can now work in your browser. Restart ${result.newBrowsers.join(', ')} once to connect it.`,
                    'OK',
                    'Don\'t Show Again'
                );
                if (choice === 'Don\'t Show Again') {
                    await context.globalState.update(NOTICE_DISMISSED, true);
                }
            }
        } catch (error) {
            diagnostics.error('Browser integration setup failed.', error);
            if (interactive) {
                void vscode.window.showErrorMessage(`Nova AI could not set up the browser integration: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };

    if (vscode.workspace.getConfiguration('nova').get<boolean>(SETTING, true)) {
        // After startup work, so it never slows down activation.
        const timer = setTimeout(() => void setUp(false), 3_000);
        context.subscriptions.push({ dispose: () => clearTimeout(timer) });
    }

    return vscode.commands.registerCommand(COMMAND_SET_UP_BROWSER, () => setUp(true));
}
