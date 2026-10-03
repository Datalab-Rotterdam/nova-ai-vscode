import { createFileTool, editFileTool } from './editTools';
import { findFilesTool, getDiagnosticsTool, listDirTool, readFileTool, searchTextTool } from './readTools';
import { runCommandTool } from './terminalTool';
import { fetchUrlTool } from './webTools';
import type { NovaTool } from './types';

/** Built-in tools of the Nova chat panel; they work without Copilot or a chat request token. */
export const BUILT_IN_TOOLS: readonly NovaTool<never>[] = [
    readFileTool,
    listDirTool,
    findFilesTool,
    searchTextTool,
    getDiagnosticsTool,
    editFileTool,
    createFileTool,
    runCommandTool,
    fetchUrlTool
] as unknown as NovaTool<never>[];

export type { NovaTool, ProposedEdit, ToolPreparation } from './types';
export { ToolInputError } from './types';
