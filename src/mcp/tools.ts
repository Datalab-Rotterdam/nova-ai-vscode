import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolInputError, type NovaTool, type ToolImage, type ToolOutput } from '../agent/tools/types';

/** Model APIs accept function names of this charset and length. */
const MAX_NAME_LENGTH = 64;
const MAX_DETAIL_CHARS = 2_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** A tool of a connected server, under the name the model sees. */
export interface McpToolEntry {
    server: string;
    /** `mcp__<server>__<tool>`, as in Claude Code, so permission rules carry over. */
    name: string;
    tool: Tool;
}

export interface McpToolCaller {
    callTool(server: string, tool: string, args: Record<string, unknown>, token: vscode.CancellationToken): Promise<{ content: unknown[]; isError?: boolean }>;
}

/** `mcp__<server>__<tool>`, sanitized; too long names keep a hash so they stay unique. */
export function mcpToolName(server: string, tool: string): string {
    const name = `mcp__${sanitize(server)}__${sanitize(tool)}`;
    if (name.length <= MAX_NAME_LENGTH) {
        return name;
    }
    const hash = createHash('sha1').update(`${server}\0${tool}`).digest('hex').slice(0, 6);
    return `${name.slice(0, MAX_NAME_LENGTH - 7)}_${hash}`;
}

/** The server of an `mcp__<server>__<tool>` name. */
export function mcpServerOf(name: string): string | undefined {
    return /^mcp__(.+?)__/.exec(name)?.[1];
}

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** A tool result as text for the model, with its images (ported from nova-ai-next `flattenMcpContent`). */
export function flattenMcpContent(content: unknown[]): ToolOutput {
    const images: ToolImage[] = [];
    const text = content.map((part) => {
        if (!part || typeof part !== 'object' || !('type' in part)) {
            return '[unsupported content]';
        }
        const typed = part as Record<string, unknown>;
        switch (typed.type) {
            case 'text':
                return typeof typed.text === 'string' ? typed.text : '';
            case 'image': {
                const mimeType = typeof typed.mimeType === 'string' ? typed.mimeType : 'image/png';
                if (typeof typed.data === 'string' && IMAGE_TYPES.has(mimeType)) {
                    images.push({ mimeType, data: Buffer.from(typed.data, 'base64') });
                    return '[Image attached]';
                }
                return `[Image (${mimeType}) not shown]`;
            }
            case 'audio':
                return '[Audio not shown]';
            case 'resource_link':
                return `[Resource link: ${typeof typed.name === 'string' ? typed.name : String(typed.uri ?? 'unknown')} (${String(typed.uri ?? '')})]`;
            case 'resource': {
                const resource = (typed.resource ?? {}) as Record<string, unknown>;
                return typeof resource.text === 'string' ? resource.text : `[Embedded resource: ${String(resource.uri ?? 'unknown')}]`;
            }
            default:
                return `[unsupported content type: ${String(typed.type)}]`;
        }
    }).join('\n');
    return { text: text || '(no output)', images };
}

/** An MCP tool as a Nova tool, so approvals, permission rules and read-only modes apply to it. */
export function createMcpTool(entry: McpToolEntry, caller: McpToolCaller): NovaTool<Record<string, unknown>> {
    const title = entry.tool.annotations?.title ?? entry.tool.title ?? entry.tool.name;
    return {
        name: entry.name,
        description: entry.tool.description ?? `${entry.tool.name} from MCP server ${entry.server}.`,
        inputSchema: entry.tool.inputSchema as Record<string, unknown>,
        readOnly: entry.tool.annotations?.readOnlyHint === true,
        prepare: async (input) => {
            const detail = JSON.stringify(input ?? {}, null, 2);
            return {
                title: `${entry.server}: ${title}`,
                detail: detail === '{}' ? undefined : detail.length > MAX_DETAIL_CHARS ? `${detail.slice(0, MAX_DETAIL_CHARS)}…` : detail
            };
        },
        invoke: async (input, context) => {
            const result = await caller.callTool(entry.server, entry.tool.name, input ?? {}, context.token);
            const output = flattenMcpContent(result.content);
            if (result.isError) {
                throw new ToolInputError(output.text);
            }
            return output.images.length ? output : output.text;
        }
    };
}
