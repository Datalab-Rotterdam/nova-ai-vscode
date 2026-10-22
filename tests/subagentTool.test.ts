import { describe, expect, it } from 'vitest';
import { createSubagentTool, runLimited, type SubagentHost, type SubagentOutcome } from '../src/agent/tools/subagentTool';
import { ToolInputError } from '../src/agent/tools/types';
import { TOOL_GROUPS } from '../src/agents/AgentService';

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;
const ok = (report: string): SubagentOutcome => ({ status: 'done', report, rounds: 2, tokens: 100, model: 'm' });

function fakeHost(overrides: Partial<SubagentHost> = {}, state = { running: 0, peak: 0, started: 0 }): SubagentHost {
    return {
        limits: () => ({ maxPerCall: 3, maxParallel: 2 }),
        models: () => [],
        reserve: (count) => {
            if (state.started + count > 5) {
                throw new ToolInputError('budget used up');
            }
            state.started += count;
        },
        register: (tasks) => tasks.map((_, index) => `id-${index}`),
        run: async (_id, task) => {
            state.running++;
            state.peak = Math.max(state.peak, state.running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            state.running--;
            return ok(`report for ${task.name}`);
        },
        ...overrides
    };
}

const call = (tool: ReturnType<typeof createSubagentTool>, input: unknown) =>
    (tool as unknown as { invoke(input: unknown, context: unknown, prep: unknown): Promise<string> }).invoke(input, { token }, {});

describe('spawn_agents', () => {
    it('is in the subagents tool group and read-only', () => {
        expect(TOOL_GROUPS.subagents).toEqual(['spawn_agents']);
        expect(createSubagentTool(fakeHost()).readOnly).toBe(true);
    });

    it('caps the schema at maxPerCall and offers no model choice by default', () => {
        const schema = JSON.stringify(createSubagentTool(fakeHost()).inputSchema);
        expect(schema).toContain('"maxItems":3');
        expect(schema).not.toContain('"model"');
    });

    it('offers allowed models as an enum', () => {
        const tool = createSubagentTool(fakeHost({ models: () => [{ id: 'fast', name: 'Fast' }] }));
        expect(JSON.stringify(tool.inputSchema)).toContain('"enum":["fast"]');
    });

    it('rejects more agents than allowed per call', async () => {
        const tool = createSubagentTool(fakeHost());
        const agents = Array.from({ length: 4 }, (_, i) => ({ name: `a${i}`, prompt: 'x' }));
        await expect(call(tool, { agents })).rejects.toThrow(/At most 3/);
    });

    it('rejects an agent without a brief', async () => {
        await expect(call(createSubagentTool(fakeHost()), { agents: [{ name: 'a', prompt: ' ' }] })).rejects.toThrow(/needs a "prompt"/);
    });

    it('stops when the budget of the answer is used up', async () => {
        const tool = createSubagentTool(fakeHost());
        const agents = [{ name: 'a', prompt: 'x' }, { name: 'b', prompt: 'y' }, { name: 'c', prompt: 'z' }];
        await call(tool, { agents });
        await expect(call(tool, { agents })).rejects.toThrow(/budget used up/);
    });

    it('runs at most maxParallel agents at once and reports each', async () => {
        const state = { running: 0, peak: 0, started: 0 };
        const tool = createSubagentTool(fakeHost({}, state));
        const text = await call(tool, { agents: [{ name: 'one', prompt: 'x' }, { name: 'two', prompt: 'y' }, { name: 'three', prompt: 'z' }] });
        expect(state.peak).toBe(2);
        expect(text).toContain('## one (done');
        expect(text).toContain('report for three');
    });

    it('turns a failing agent into a report instead of failing the call', async () => {
        const tool = createSubagentTool(fakeHost({
            run: async (_id, task) => {
                if (task.name === 'bad') {
                    throw new Error('boom');
                }
                return ok('fine');
            }
        }));
        const text = await call(tool, { agents: [{ name: 'good', prompt: 'x' }, { name: 'bad', prompt: 'y' }] });
        expect(text).toContain('1 did not complete');
        expect(text).toContain('## bad (failed');
        expect(text).toContain('boom');
    });

    it('drops a model that is not allowed', async () => {
        const seen: Array<string | undefined> = [];
        const tool = createSubagentTool(fakeHost({
            models: () => [{ id: 'fast', name: 'Fast' }],
            run: async (_id, task) => {
                seen.push(task.model);
                return ok('r');
            }
        }));
        await call(tool, { agents: [{ name: 'a', prompt: 'x', model: 'fast' }, { name: 'b', prompt: 'y', model: 'huge' }] });
        expect(seen).toEqual(['fast', undefined]);
    });

    it('does not start agents once the call is cancelled', async () => {
        let ran = 0;
        const tool = createSubagentTool(fakeHost({ run: async () => { ran++; return ok('r'); } }));
        const cancelled = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) };
        const text = await (tool as unknown as { invoke(i: unknown, c: unknown, p: unknown): Promise<string> })
            .invoke({ agents: [{ name: 'a', prompt: 'x' }] }, { token: cancelled }, {});
        expect(ran).toBe(0);
        expect(text).toContain('stopped by the user');
    });
});

describe('runLimited', () => {
    it('keeps the order of the results', async () => {
        const results = await runLimited([30, 1, 10].map((ms, i) => async () => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return i;
        }), 2);
        expect(results).toEqual([0, 1, 2]);
    });
});
