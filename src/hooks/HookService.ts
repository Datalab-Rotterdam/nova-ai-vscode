import * as path from 'node:path';
import type * as vscode from 'vscode';
import { runShell } from '../agent/tools/terminalTool';

/**
 * Hooks in Claude Code's format, from the same settings files as the permission rules
 * (docs/NOVA_HOME.md, "Hooks"):
 *
 * ```json
 * { "hooks": { "PreToolUse": [{ "matcher": "run_command|Bash", "hooks": [{ "type": "command", "command": "./check.sh", "timeout": 30 }] }] } }
 * ```
 *
 * A hook gets the event as JSON on stdin. Exit code 2 blocks (stderr says why); exit 0 may
 * print JSON (`decision`, `reason`, `hookSpecificOutput`); any other exit code is a warning.
 */
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop' | 'SessionStart';

export interface HookOutcome {
    /** Why the hook blocked: the tool call, the prompt, or stopping. */
    block?: string;
    /** A PreToolUse hook approved the call: no approval card. */
    allow?: boolean;
    /** Text for the model: plain stdout of UserPromptSubmit/SessionStart hooks, or `additionalContext`. */
    context?: string;
    /** Hooks that failed without blocking, for the user. */
    warnings: string[];
}

const DEFAULT_TIMEOUT_SECONDS = 60;
/** Claude Code's tool names, so hooks copied from `.claude/settings.json` match Nova's tools. */
const CLAUDE_NAMES: Record<string, string> = {
    run_command: 'Bash',
    read_file: 'Read',
    edit_file: 'Edit',
    create_file: 'Write',
    find_files: 'Glob',
    search_text: 'Grep',
    list_dir: 'LS',
    fetch_url: 'WebFetch',
    web_search: 'WebSearch',
    todo_write: 'TodoWrite'
};

interface HookCommand {
    command: string;
    timeout: number;
}

export class HookService {
    public constructor(
        private readonly config: () => Promise<Record<string, unknown[]>>,
        private readonly cwd: () => string | undefined
    ) {
    }

    /** Runs the event's matching hooks in parallel and combines what they decided. */
    public async run(event: HookEvent, payload: Record<string, unknown>, token: vscode.CancellationToken): Promise<HookOutcome> {
        const outcome: HookOutcome = { warnings: [] };
        const cwd = this.cwd();
        const commands = cwd ? matchingCommands(await this.config(), event, typeof payload.tool_name === 'string' ? payload.tool_name : undefined) : [];
        if (!cwd || !commands.length) {
            return outcome;
        }
        const input = JSON.stringify({ ...payload, ...withClaudeFields(payload, cwd), hook_event_name: event, cwd });
        const results = await Promise.all(commands.map((hook) => runShell(hook.command, cwd, hook.timeout * 1000, token, {
            stdin: input,
            env: { NOVA_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd }
        }).then((result) => ({ hook, result }))));

        const blocks: string[] = [];
        const context: string[] = [];
        for (const { hook, result } of results) {
            if (result.cancelled) {
                continue;
            }
            if (result.timedOut) {
                outcome.warnings.push(`Hook "${hook.command}" timed out after ${hook.timeout}s.`);
            } else if (result.exitCode === 2) {
                blocks.push(result.stderr || `Blocked by hook "${hook.command}".`);
            } else if (result.exitCode !== 0) {
                outcome.warnings.push(`Hook "${hook.command}" failed (exit code ${result.exitCode})${result.stderr ? `: ${result.stderr}` : '.'}`);
            } else {
                const decision = parseDecision(result.stdout);
                if (decision) {
                    if (decision.block !== undefined) {
                        blocks.push(decision.block || `Blocked by hook "${hook.command}".`);
                    }
                    outcome.allow ||= decision.allow;
                    if (decision.context) {
                        context.push(decision.context);
                    }
                } else if (result.stdout && (event === 'UserPromptSubmit' || event === 'SessionStart')) {
                    context.push(result.stdout);
                }
            }
        }
        if (blocks.length) {
            outcome.block = blocks.join('\n');
            outcome.allow = false;
        }
        if (context.length) {
            outcome.context = context.join('\n');
        }
        return outcome;
    }
}

/** The commands of the event's matchers that match the tool (matchers only apply to tool events). */
export function matchingCommands(config: Record<string, unknown[]>, event: HookEvent, toolName?: string): HookCommand[] {
    const names = toolName ? [toolName, CLAUDE_NAMES[toolName]].filter(Boolean) : [];
    return (config[event] ?? []).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
            return [];
        }
        const { matcher, hooks } = entry as { matcher?: unknown; hooks?: unknown };
        if (toolName && typeof matcher === 'string' && matcher && matcher !== '*' && !names.some((name) => matches(matcher, name))) {
            return [];
        }
        return (Array.isArray(hooks) ? hooks : []).flatMap((hook): HookCommand[] => {
            const { type, command, timeout } = (hook ?? {}) as { type?: unknown; command?: unknown; timeout?: unknown };
            return (type === undefined || type === 'command') && typeof command === 'string' && command.trim()
                ? [{ command, timeout: typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS }]
                : [];
        });
    });
}

/** A matcher is a regular expression over the whole tool name (`Edit|Write`, `mcp__github__.*`). */
function matches(matcher: string, name: string): boolean {
    try {
        return new RegExp(`^(?:${matcher})$`).test(name);
    } catch {
        return matcher === name;
    }
}

/** What Claude Code hooks expect besides Nova's own fields: an absolute `file_path`. */
function withClaudeFields(payload: Record<string, unknown>, cwd: string): Record<string, unknown> {
    const input = payload.tool_input as Record<string, unknown> | undefined;
    if (input && typeof input.path === 'string' && input.file_path === undefined) {
        return { tool_input: { ...input, file_path: path.resolve(cwd, input.path) } };
    }
    return {};
}

/** The decision in a hook's JSON output, if it printed JSON. */
function parseDecision(stdout: string): { block?: string; allow?: boolean; context?: string } | undefined {
    if (!stdout.startsWith('{')) {
        return undefined;
    }
    let output: Record<string, unknown>;
    try {
        output = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    const specific = (output.hookSpecificOutput ?? {}) as Record<string, unknown>;
    const reason = typeof output.reason === 'string' ? output.reason : undefined;
    const permissionReason = typeof specific.permissionDecisionReason === 'string' ? specific.permissionDecisionReason : reason;
    const blocked = output.decision === 'block' || specific.permissionDecision === 'deny' || output.continue === false;
    return {
        ...(blocked ? { block: (output.decision === 'block' ? reason : output.continue === false ? output.stopReason as string | undefined : permissionReason) ?? '' } : {}),
        allow: output.decision === 'approve' || specific.permissionDecision === 'allow',
        context: typeof specific.additionalContext === 'string' ? specific.additionalContext : undefined
    };
}
