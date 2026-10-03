import { type ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { NovaTool, ToolInputError } from './types';
import { ensureDir } from '../../storage/NovaHome';
import { getScratchRoot, resolveWorkspacePath, truncateMiddle, workspaceFolders } from './workspacePaths';

const MAX_OUTPUT_CHARS = 30_000;

interface RunCommandInput { command: string; cwd?: string }

export const runCommandTool: NovaTool<RunCommandInput> = {
    name: 'run_command',
    description:
        'Run a shell command in the workspace (for example tests, builds or git status) and return its exit code and output. ' +
        'Commands are non-interactive and time out; do not start servers or watchers.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Shell command line to run.' },
            cwd: { type: 'string', description: 'Workspace-relative working directory, or "scratch" for the scratch folder; defaults to the workspace root.' }
        },
        required: ['command']
    },
    readOnly: false,
    async prepare(input) {
        if (typeof input.command !== 'string' || !input.command.trim()) {
            throw new ToolInputError('A "command" is required.');
        }
        return { title: 'Run command', detail: input.command.trim() };
    },
    async invoke(input, context) {
        const requested = input.cwd?.trim();
        const cwd = requested ? resolveWorkspacePath(requested).fsPath : workspaceFolders()[0]?.uri.fsPath ?? getScratchRoot();
        if (cwd && cwd === getScratchRoot()) {
            await ensureDir(cwd);
        }
        if (!cwd) {
            throw new ToolInputError('No workspace folder is open.');
        }
        const timeoutSeconds = vscode.workspace.getConfiguration('nova').get<number>('agent.commandTimeoutSeconds', 120);
        const result = await runShell(input.command.trim(), cwd, timeoutSeconds * 1_000, context.token);
        const status = result.timedOut
            ? `Timed out after ${timeoutSeconds}s`
            : result.cancelled ? 'Cancelled' : `Exit code ${result.exitCode}`;
        return `${status}\n${truncateMiddle(result.output, MAX_OUTPUT_CHARS) || '(no output)'}`;
    }
};

interface ShellResult {
    exitCode: number | null;
    output: string;
    timedOut: boolean;
    cancelled: boolean;
}

export function runShell(command: string, cwd: string, timeoutMs: number, token: vscode.CancellationToken): Promise<ShellResult> {
    return new Promise((resolve) => {
        // Own process group on POSIX, so a timeout or stop also ends the command's children
        // (the shell may not exec the command itself, e.g. dash on Linux, and npm spawns node).
        const child = spawn(command, {
            cwd,
            shell: true,
            detached: process.platform !== 'win32',
            env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
        });
        let output = '';
        let timedOut = false;
        let cancelled = false;
        let settled = false;
        let forceTimer: NodeJS.Timeout | undefined;
        const append = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > MAX_OUTPUT_CHARS * 4) {
                output = output.slice(output.length - MAX_OUTPUT_CHARS * 2);
            }
        };

        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.stdin.end();

        const stop = () => {
            killTree(child, 'SIGTERM');
            // Escalate if the command ignores SIGTERM, and stop waiting for pipes a grandchild may still hold.
            forceTimer = setTimeout(() => {
                killTree(child, 'SIGKILL');
                finish(child.exitCode);
            }, KILL_GRACE_MS);
        };

        const timer = setTimeout(() => {
            timedOut = true;
            stop();
        }, timeoutMs);
        const subscription = token.onCancellationRequested(() => {
            cancelled = true;
            stop();
        });

        function finish(exitCode: number | null) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            clearTimeout(forceTimer);
            subscription.dispose();
            child.stdout.destroy();
            child.stderr.destroy();
            resolve({ exitCode, output: output.trimEnd(), timedOut, cancelled });
        }
        child.on('error', (error) => {
            output += `\n${error.message}`;
            finish(null);
        });
        child.on('close', (code) => finish(code));
    });
}

const KILL_GRACE_MS = 1_000;

/** Kills the command and everything it started. */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined || child.exitCode !== null && signal === 'SIGTERM') {
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => undefined);
        } else {
            process.kill(-child.pid, signal);
        }
    } catch {
        // Already gone, or no process group: fall back to the shell itself.
        try {
            child.kill(signal);
        } catch {
            // already exited
        }
    }
}
