import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentAllowsTool, findAgent, listAgents, parseAgent } from '../src/agents/AgentService';

const builtinDir = path.join(__dirname, '..', 'resources', 'chat', 'agents', 'modes');

describe('parseAgent', () => {
    it('reads frontmatter, expands tool groups and keeps the body as prompt', () => {
        const agent = parseAgent('---\nname: Docs\ndescription: Writes docs\ntools: [read, "web", edit_file]\nreadOnly: false\n---\nBe brief.\n', 'docs.agent.md', 'global')!;
        expect(agent).toMatchObject({ id: 'docs', name: 'Docs', description: 'Writes docs', prompt: 'Be brief.', readOnly: false, source: 'global' });
        expect(agent.tools).toEqual(expect.arrayContaining(['read_file', 'fetch_url', 'edit_file']));
        expect(agent.tools).not.toContain('run_command');
    });

    it('reads block lists', () => {
        const agent = parseAgent('---\ntools:\n  - search\n  - ask\n---\nx', 'a.md', 'builtin')!;
        expect(agent.tools).toEqual(['list_dir', 'find_files', 'search_text', 'ask_user']);
    });
});

describe('listAgents', () => {
    it('lists the built-in agents in menu order and hides helpers', () => {
        const agents = listAgents({ builtinDir, novaHome: '/nonexistent' });
        expect(agents.filter((agent) => agent.selectable).map((agent) => agent.id)).toEqual(['interactive', 'plan', 'autopilot', 'ask']);
        expect(findAgent(agents, 'explore').id).toBe('interactive');
        expect(findAgent(agents, 'plan')).toMatchObject({ readOnly: true });
        expect(findAgent(agents, 'autopilot').autopilot).toBe(true);
    });

    it('lets a project agent replace a global one with the same id', () => {
        const home = mkdtempSync(path.join(os.tmpdir(), 'nova-agents-'));
        const project = path.join(home, 'projects', 'p');
        mkdirSync(path.join(home, 'agents'), { recursive: true });
        mkdirSync(path.join(project, 'agents'), { recursive: true });
        writeFileSync(path.join(home, 'agents', 'review.agent.md'), '---\nname: Global review\n---\ng');
        writeFileSync(path.join(project, 'agents', 'review.agent.md'), '---\nname: Project review\n---\np');
        const agents = listAgents({ builtinDir, novaHome: home, projectDir: project });
        expect(agents.filter((agent) => agent.id === 'review')).toMatchObject([{ name: 'Project review', source: 'project' }]);
        expect(agents.at(-1)!.id).toBe('review');
    });
});

describe('bundled agents', () => {
    it('cannot be replaced by a user agent with the same id', () => {
        const home = mkdtempSync(path.join(os.tmpdir(), 'nova-agents-'));
        mkdirSync(path.join(home, 'agents'), { recursive: true });
        writeFileSync(path.join(home, 'agents', 'plan.agent.md'), '---\nname: Hijacked\ntools: [run]\n---\nx');
        const plan = findAgent(listAgents({ builtinDir, novaHome: home }), 'plan');
        expect(plan).toMatchObject({ name: 'Plan', source: 'builtin', readOnly: true });
    });
});

describe('agentAllowsTool', () => {
    it('allows everything without a list, and todo_write always', () => {
        const plan = findAgent(listAgents({ builtinDir, novaHome: '/nonexistent' }), 'plan');
        expect(agentAllowsTool(plan, 'read_file')).toBe(true);
        expect(agentAllowsTool(plan, 'edit_file')).toBe(false);
        expect(agentAllowsTool(plan, 'todo_write')).toBe(true);
        expect(agentAllowsTool(plan, 'mcp_x', true)).toBe(false);
        expect(agentAllowsTool(findAgent([], undefined), 'edit_file')).toBe(true);
    });
});
