import * as vscode from 'vscode';

/** OpenAI-compatible servers reject more tools than this. */
export const MAX_TOOLS = 128;

const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Bidirectional mapping between VS Code tool names and the names sent to Nova.
 * Most names pass through unchanged; names with characters servers reject
 * (dots, spaces, too long) are sanitized and mapped back on the way out.
 */
export class ToolNameMap {
    private readonly toNovaNames = new Map<string, string>();
    private readonly fromNovaNames = new Map<string, string>();

    public constructor(names: readonly string[] = []) {
        for (const name of names) {
            this.register(name);
        }
    }

    public toNova(name: string): string {
        return this.toNovaNames.get(name) ?? this.register(name);
    }

    /** Returns the VS Code tool name for a name the model produced, or undefined when unknown. */
    public fromNova(name: string): string | undefined {
        return this.fromNovaNames.get(name);
    }

    public get size(): number {
        return this.toNovaNames.size;
    }

    private register(name: string): string {
        const existing = this.toNovaNames.get(name);
        if (existing) {
            return existing;
        }

        let candidate = VALID_TOOL_NAME.test(name) ? name : sanitizeToolName(name);
        for (let suffix = 2; this.fromNovaNames.has(candidate); suffix++) {
            candidate = `${sanitizeToolName(name).slice(0, 60)}_${suffix}`;
        }

        this.toNovaNames.set(name, candidate);
        this.fromNovaNames.set(candidate, name);
        return candidate;
    }
}

function sanitizeToolName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return sanitized || 'tool';
}

export interface ToolPayload {
    payload: Record<string, unknown>;
    names: ToolNameMap;
    dropped: string[];
}

export function createToolPayload(options: vscode.ProvideLanguageModelChatResponseOptions): ToolPayload {
    const tools = options.tools ?? [];
    if (!tools.length) {
        return { payload: {}, names: new ToolNameMap(), dropped: [] };
    }

    const kept = tools.slice(0, MAX_TOOLS);
    const names = new ToolNameMap(kept.map((tool) => tool.name));

    return {
        payload: {
            tools: kept.map((tool) => ({
                type: 'function',
                function: {
                    name: names.toNova(tool.name),
                    description: tool.description || tool.name,
                    parameters: normalizeSchema(tool.inputSchema)
                }
            })),
            tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto'
        },
        names,
        dropped: tools.slice(MAX_TOOLS).map((tool) => tool.name)
    };
}

/**
 * Normalizes a tool input schema so strict servers accept it: the root must be
 * an object schema with `properties`, and `$schema` keys are removed everywhere.
 */
export function normalizeSchema(schema: unknown): Record<string, unknown> {
    const normalized = isRecord(schema) ? stripSchemaKeys(schema) as Record<string, unknown> : {};

    if (normalized.type === undefined) {
        normalized.type = 'object';
    }
    if (normalized.type === 'object' && !isRecord(normalized.properties)) {
        normalized.properties = {};
    }

    return normalized;
}

function stripSchemaKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stripSchemaKeys);
    }
    if (!isRecord(value)) {
        return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (key !== '$schema') {
            result[key] = stripSchemaKeys(child);
        }
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
