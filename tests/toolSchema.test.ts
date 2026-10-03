import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createToolPayload, MAX_TOOLS, normalizeSchema, ToolNameMap } from '../src/model/toolSchema';

describe('tool payload', () => {
  it('normalizes schemas that strict servers reject', () => {
    expect(normalizeSchema(undefined)).toEqual({ type: 'object', properties: {} });
    expect(normalizeSchema({ $schema: 'x', properties: { a: { type: 'string', $schema: 'y' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } }
    });
  });

  it('caps the number of tools and reports the dropped ones', () => {
    const tools = Array.from({ length: MAX_TOOLS + 2 }, (_, index) => ({ name: `tool_${index}`, description: '', inputSchema: undefined }));
    const { payload, dropped } = createToolPayload({ tools, toolMode: vscode.LanguageModelChatToolMode.Auto });

    expect((payload.tools as unknown[]).length).toBe(MAX_TOOLS);
    expect(dropped).toEqual([`tool_${MAX_TOOLS}`, `tool_${MAX_TOOLS + 1}`]);
    expect(payload.tool_choice).toBe('auto');
  });

  it('sanitizes invalid tool names and maps them back', () => {
    const names = new ToolNameMap(['valid_name', 'mcp.server/tool', 'mcp.server-tool']);

    expect(names.toNova('valid_name')).toBe('valid_name');
    expect(names.toNova('mcp.server/tool')).toBe('mcp_server_tool');
    expect(names.toNova('mcp.server-tool')).not.toBe('mcp_server_tool');
    expect(names.fromNova('mcp_server_tool')).toBe('mcp.server/tool');
    expect(names.fromNova('unknown')).toBeUndefined();
  });
});
