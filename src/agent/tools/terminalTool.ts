import { spawn } from 'node:child_process';
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
        const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
        let output = '';
        let timedOut = false;
        let cancelled = false;
        const append = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > MAX_OUTPUT_CHARS * 4) {
                output = output.slice(output.length - MAX_OUTPUT_CHARS * 2);
            }
        };

        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.stdin.end();

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        const subscription = token.onCancellationRequested(() => {
            cancelled = true;
            child.kill();
        });

        const finish = (exitCode: number | null) => {
            clearTimeout(timer);
            subscription.dispose();
            resolve({ exitCode, output: output.trimEnd(), timedOut, cancelled });
        };
        child.on('error', (error) => {
            output += `\n${error.message}`;
            finish(null);
        });
        child.on('close', finish);
    });
}
