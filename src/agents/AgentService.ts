import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/*
 * Agents are markdown files with frontmatter; the body is added to the system prompt.
 * Built in: resources/chat/agents/modes/*.md. Your own: `<name>.agent.md` in
 * ~/.nova-ai/agents (global) and ~/.nova-ai/projects/<key>/agents (project); a project
 * agent replaces a global one with the same id. Built-in agents are bundled with the
 * extension: they cannot be replaced, edited or deleted, an agent file with a built-in
 * id is ignored.
 */

export type AgentSource = 'builtin' | 'global' | 'project';

export interface AgentDefinition {
    id: string;
    name: string;
    description: string;
    /** Codicon name shown in the menu. */
    icon: string;
    source: AgentSource;
    /** The agent's file; unset for the built-in Interactive agent. */
    path?: string;
    /** System prompt addition (the markdown body). */
    prompt: string;
    /** Tool names (groups already expanded) the agent may use; undefined means all of them. */
    tools?: string[];
    /** Only tools that do not change anything are offered and accepted. */
    readOnly: boolean;
    /** Runs without the tool round limit and answers its own questions. */
    autopilot: boolean;
    /** Shown in the menu; false for helpers such as the explore agent. */
    selectable: boolean;
}

export interface AgentPaths {
    /** resources/chat/agents/modes of the extension. */
    builtinDir: string;
    /** $NOVA_AI_HOME or ~/.nova-ai. */
    novaHome: string;
    /** ~/.nova-ai/projects/<key>, if the workspace has one. */
    projectDir?: string;
}

export const DEFAULT_AGENT_ID = 'interactive';

/** The id an agent file name gives (`Code Review.agent.md` → `code-review`). */
export function agentIdOf(fileName: string): string {
    return fileName.replace(/\.agent\.md$|\.md$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** What a frontmatter `tools:` entry may name besides a tool: a group of Nova's tools. */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
    read: ['read_file', 'list_dir', 'find_files', 'search_text', 'get_diagnostics'],
    search: ['list_dir', 'find_files', 'search_text'],
    edit: ['edit_file', 'create_file'],
    run: ['run_command'],
    web: ['fetch_url', 'web_search'],
    memory: ['memory_read', 'memory_write'],
    ask: ['ask_user'],
    todo: ['todo_write'],
    skills: ['load_skill'],
    subagents: ['spawn_agents']
};

/** Always on the list of an agent that restricts its tools; they only show UI. */
const ALWAYS_TOOLS = ['todo_write'];

const INTERACTIVE: AgentDefinition = {
    id: DEFAULT_AGENT_ID,
    name: 'Interactive',
    description: 'Step-by-step collaboration',
    icon: 'comment',
    source: 'builtin',
    prompt: '',
    readOnly: false,
    autopilot: false,
    selectable: true
};

/** Interactive first, then the other built-in agents, then yours by name. */
export function listAgents(paths: AgentPaths): AgentDefinition[] {
    const byId = new Map<string, AgentDefinition>([[INTERACTIVE.id, INTERACTIVE]]);
    const sources: Array<[string, AgentSource]> = [
        [paths.builtinDir, 'builtin'],
        [path.join(paths.novaHome, 'agents'), 'global'],
        ...(paths.projectDir ? [[path.join(paths.projectDir, 'agents'), 'project'] as [string, AgentSource]] : [])
    ];
    for (const [dir, source] of sources) {
        for (const file of markdownFiles(dir, source === 'builtin')) {
            const agent = parseAgent(readFile(file), path.basename(file), source, file);
            if (agent && (source === 'builtin' || !byId.get(agent.id)?.source.startsWith('builtin'))) {
                byId.set(agent.id, agent);
            }
        }
    }
    const order = ['interactive', 'plan', 'autopilot', 'ask'];
    return [...byId.values()].sort((left, right) => {
        const l = left.source === 'builtin' ? order.indexOf(left.id) : -1;
        const r = right.source === 'builtin' ? order.indexOf(right.id) : -1;
        if (left.source === 'builtin' && right.source === 'builtin') {
            return (l < 0 ? order.length : l) - (r < 0 ? order.length : r);
        }
        return left.source === 'builtin' ? -1 : right.source === 'builtin' ? 1 : left.name.localeCompare(right.name);
    });
}

export function findAgent(agents: readonly AgentDefinition[], id: string | undefined): AgentDefinition {
    return agents.find((agent) => agent.id === id && agent.selectable) ?? INTERACTIVE;
}

/** Whether the agent offers a tool: its `tools` list, plus MCP tools only when `mcp` is listed. */
export function agentAllowsTool(agent: AgentDefinition, toolName: string, isMcp = false): boolean {
    if (!agent.tools) {
        return true;
    }
    return isMcp ? agent.tools.includes('mcp') : agent.tools.includes(toolName) || ALWAYS_TOOLS.includes(toolName);
}

export function parseAgent(content: string, fileName: string, source: AgentSource, filePath?: string): AgentDefinition | undefined {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(content);
    const frontmatter = match?.[1] ?? '';
    const prompt = (match ? match[2] : content).trim();
    const id = agentIdOf(fileName);
    if (!id) {
        return undefined;
    }
    const tools = listValue(frontmatter, 'tools');
    return {
        id,
        name: scalar(frontmatter, 'name') || id,
        description: scalar(frontmatter, 'description') || 'No description provided.',
        icon: scalar(frontmatter, 'icon') || 'robot',
        source,
        ...(filePath ? { path: filePath } : {}),
        prompt,
        ...(tools ? { tools: expandTools(tools) } : {}),
        readOnly: scalar(frontmatter, 'readOnly') === 'true',
        autopilot: scalar(frontmatter, 'autopilot') === 'true',
        selectable: scalar(frontmatter, 'user-invocable') !== 'false'
    };
}

function expandTools(entries: readonly string[]): string[] {
    return [...new Set(entries.flatMap((entry) => TOOL_GROUPS[entry] ?? [entry]))];
}

function scalar(frontmatter: string, key: string): string {
    const raw = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter)?.[1]?.trim() ?? '';
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1).replace(/\\"/g, '"');
    }
    return raw;
}

/** `key: [a, "b"]` on one line, or a block that goes over several lines (`- a`). */
function listValue(frontmatter: string, key: string): string[] | undefined {
    const inline = new RegExp(`^${key}:[ \\t]*\\[([\\s\\S]*?)\\]`, 'm').exec(frontmatter)?.[1];
    const block = new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]+-[^\\n]*\\n?)+)`, 'm').exec(frontmatter)?.[1];
    const raw = inline ?? block?.replace(/^\s*-\s*/gm, ',');
    if (raw === undefined) {
        return undefined;
    }
    return raw.split(',').map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function markdownFiles(dir: string, anyMarkdown: boolean): string[] {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && (anyMarkdown ? entry.name.endsWith('.md') : entry.name.endsWith('.agent.md')))
            .map((entry) => path.join(dir, entry.name))
            .sort();
    } catch {
        return [];
    }
}

function readFile(file: string): string {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

/** Template for a new agent file. */
export function agentTemplate(name: string): string {
    return [
        '---',
        `name: ${name}`,
        'description: What this agent is for, in one line.',
        'icon: robot',
        '# Optional: limit the tools. Groups: read, search, edit, run, web, memory, ask, todo, skills, mcp; or tool names.',
        '# tools: [read, search, web]',
        '# readOnly: true',
        '---',
        'Instructions for the agent go here. They are added to Nova\'s system prompt.',
        ''
    ].join('\n');
}
