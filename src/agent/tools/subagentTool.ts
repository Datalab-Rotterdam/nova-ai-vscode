import type * as vscode from 'vscode';
import { NovaTool, ToolInputError } from './types';

export const SPAWN_AGENTS_TOOL = 'spawn_agents';

export interface SubagentTask {
    name: string;
    prompt: string;
    /** Model id the main agent picked; only honoured when it is an allowed model. */
    model?: string;
}

export interface SubagentOutcome {
    status: 'done' | 'error' | 'stopped';
    /** The agent's final report, or the error. */
    report: string;
    rounds: number;
    tokens: number;
    model: string;
}

export interface SubagentModelChoice {
    id: string;
    name: string;
}

/** What the chat panel provides to the tool: limits, models, and the actual running of one agent. */
export interface SubagentHost {
    limits(): { maxPerCall: number; maxParallel: number };
    /** Models Nova may choose from per task; empty when it may not choose. */
    models(): SubagentModelChoice[];
    /** Counts the agents against the budget of this answer; throws a ToolInputError when it is used up. */
    reserve(count: number): void;
    /** Registers the agents as queued (so the panel shows them at once) and returns their ids. */
    register(tasks: SubagentTask[]): string[];
    run(id: string, task: SubagentTask, token: vscode.CancellationToken): Promise<SubagentOutcome>;
}

interface SpawnInput { agents: Array<{ name?: string; prompt?: string; model?: string }> }

const MAX_BRIEF_CHARS = 8_000;

/** Runs `jobs` with at most `limit` at a time, keeping the result order. */
export async function runLimited<T>(jobs: ReadonlyArray<() => Promise<T>>, limit: number): Promise<T[]> {
    const results = new Array<T>(jobs.length);
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const index = next++;
            results[index] = await jobs[index]!();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
}

/** The spawn_agents tool: research agents that work in parallel and each return a report. */
export function createSubagentTool(host: SubagentHost): NovaTool<never> {
    const { maxPerCall } = host.limits();
    const models = host.models();
    const tool: NovaTool<SpawnInput> = {
        name: SPAWN_AGENTS_TOOL,
        description:
            'Start research agents that work at the same time, each on its own self-contained question, and get one report from each. ' +
            'Use it only for broad research that splits into independent parts (several areas of the codebase, unrelated questions, comparing options). ' +
            'Do NOT use it for anything you can do with one or two tool calls (reading a file, one search), for edits, or for work that depends on another agent\'s result. ' +
            `Start at most ${maxPerCall} agents per call, and as few as the task needs; two or three focused agents beat many vague ones. ` +
            'Agents cannot see this conversation or start agents themselves: write each brief so it stands alone (what to find out, where to look, what the report should contain). ' +
            'They can read and search the project, fetch web pages and run commands; they do not edit files. Trust their reports, but check what matters before acting on it.',
        inputSchema: {
            type: 'object',
            properties: {
                agents: {
                    type: 'array',
                    minItems: 1,
                    maxItems: maxPerCall,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Label of two to four words, shown to the user.' },
                            prompt: { type: 'string', description: 'Self-contained brief: the question, where to look, and the shape of the report you want.' },
                            ...(models.length
                                ? {
                                    model: {
                                        type: 'string',
                                        enum: models.map((model) => model.id),
                                        description: `Optional. Leave out to use the default model. Use a lighter one for simple lookups. Models: ${models.map((model) => `${model.id} (${model.name})`).join(', ')}.`
                                    }
                                }
                                : {})
                        },
                        required: ['name', 'prompt']
                    }
                }
            },
            required: ['agents']
        },
        // Starting agents needs no approval; what an agent runs is approved like any other call.
        readOnly: true,
        async prepare(input) {
            const count = Array.isArray(input.agents) ? input.agents.length : 0;
            return { title: `Start ${count} research ${count === 1 ? 'agent' : 'agents'}` };
        },
        async invoke(input, context) {
            const tasks = parseTasks(input, maxPerCall);
            host.reserve(tasks.length);
            const allowed = new Set(host.models().map((model) => model.id));
            const prepared = tasks.map((task) => ({ ...task, model: task.model && allowed.has(task.model) ? task.model : undefined }));
            const ids = host.register(prepared);
            const outcomes = await runLimited(
                prepared.map((task, index) => async (): Promise<SubagentOutcome> => {
                    if (context.token.isCancellationRequested) {
                        return { status: 'stopped', report: 'Stopped before it started.', rounds: 0, tokens: 0, model: '' };
                    }
                    try {
                        return await host.run(ids[index]!, task, context.token);
                    } catch (error) {
                        return { status: 'error', report: error instanceof Error ? error.message : String(error), rounds: 0, tokens: 0, model: '' };
                    }
                }),
                host.limits().maxParallel
            );
            return formatReports(prepared, outcomes);
        }
    };
    return tool as unknown as NovaTool<never>;
}

function parseTasks(input: SpawnInput, max: number): SubagentTask[] {
    if (!Array.isArray(input.agents) || !input.agents.length) {
        throw new ToolInputError('"agents" must be a non-empty array of { name, prompt }.');
    }
    if (input.agents.length > max) {
        throw new ToolInputError(`At most ${max} agents per call; you sent ${input.agents.length}. Merge related questions, or do the small ones yourself.`);
    }
    return input.agents.map((agent, index) => {
        const prompt = typeof agent?.prompt === 'string' ? agent.prompt.trim() : '';
        if (!prompt) {
            throw new ToolInputError(`Agent ${index + 1} needs a "prompt".`);
        }
        const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim().slice(0, 60) : `Agent ${index + 1}`;
        return {
            name,
            prompt: prompt.slice(0, MAX_BRIEF_CHARS),
            ...(typeof agent.model === 'string' && agent.model ? { model: agent.model } : {})
        };
    });
}

function formatReports(tasks: readonly SubagentTask[], outcomes: readonly SubagentOutcome[]): string {
    const blocks = outcomes.map((outcome, index) => {
        const label = outcome.status === 'done' ? 'done' : outcome.status === 'stopped' ? 'stopped by the user' : 'failed';
        const stats = `${outcome.rounds} ${outcome.rounds === 1 ? 'round' : 'rounds'}, ${outcome.tokens} tokens`;
        return `## ${tasks[index]!.name} (${label}; ${stats})\n${outcome.report.trim() || '(no report)'}`;
    });
    const failed = outcomes.filter((outcome) => outcome.status !== 'done').length;
    return [
        `${outcomes.length} agent${outcomes.length === 1 ? '' : 's'} finished${failed ? `, ${failed} did not complete` : ''}.`,
        ...blocks
    ].join('\n\n');
}

export const START_CODING_AGENT_TOOL = 'start_coding_agent';

/** What the chat panel provides to start a coding agent in its own git worktree. */
export interface CodingAgentHost {
    models(): SubagentModelChoice[];
    /** Creates the agent's branch and worktree and starts (or queues) it without waiting for it. */
    start(task: SubagentTask): Promise<{ branch: string; queued: boolean }>;
}

interface CodingAgentInput { name?: string; prompt?: string; model?: string }

/**
 * The start_coding_agent tool: a coding agent that works on its own branch in a separate
 * worktree, in the background, while the conversation goes on. The user reviews and merges.
 */
export function createCodingAgentTool(host: CodingAgentHost): NovaTool<never> {
    const models = host.models();
    const tool: NovaTool<CodingAgentInput> = {
        name: START_CODING_AGENT_TOOL,
        description:
            'Start a coding agent that implements a self-contained change on its own git branch, in a separate copy of the repository (a worktree), in the background. ' +
            'It returns at once; the agent keeps working after your answer, and the user reviews, merges or discards its branch when it is done. ' +
            'Use it when the user asks for work to happen in the background or in parallel, or for several independent changes at once (one agent each). ' +
            'Do NOT use it for small edits you can make yourself, or for changes that depend on each other. ' +
            'The agent cannot see this conversation: the brief must say what to change, where, and how to check it (tests, build). ' +
            'Its copy has no installed dependencies or build output; say so in the brief if it needs them (for example run npm install first).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Label of two to four words, shown to the user and used in the branch name.' },
                prompt: { type: 'string', description: 'Self-contained brief: the change, the files involved, constraints, and how to verify it.' },
                ...(models.length
                    ? { model: { type: 'string', enum: models.map((model) => model.id), description: `Optional model. Models: ${models.map((model) => `${model.id} (${model.name})`).join(', ')}.` } }
                    : {})
            },
            required: ['name', 'prompt']
        },
        // It creates a branch and a worktree: the user approves that like other changes.
        readOnly: false,
        async prepare(input) {
            return { title: `Start coding agent: ${typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'agent'}`, detail: typeof input.prompt === 'string' ? input.prompt.slice(0, 2_000) : undefined };
        },
        async invoke(input) {
            const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
            if (!prompt) {
                throw new ToolInputError('A "prompt" is required.');
            }
            const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 60) : 'Coding agent';
            const allowed = new Set(host.models().map((model) => model.id));
            const { branch, queued } = await host.start({
                name,
                prompt: prompt.slice(0, MAX_BRIEF_CHARS),
                ...(input.model && allowed.has(input.model) ? { model: input.model } : {})
            });
            return `${queued ? 'Queued' : 'Started'} coding agent "${name}" on branch ${branch}. It works in the background in its own worktree; ` +
                'the user is notified when it is done and reviews, merges or discards the branch. Do not wait for it or check on it; continue with the conversation.';
        }
    };
    return tool as unknown as NovaTool<never>;
}
