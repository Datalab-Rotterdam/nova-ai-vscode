import * as vscode from 'vscode';
import { NovaTool, ToolInputError } from './types';
import { displayPath, readText, resolveWorkspacePath, truncateMiddle, workspaceFolders } from './workspacePaths';

const MAX_READ_LINES = 2_000;
const MAX_READ_CHARS = 100_000;
const MAX_FIND_RESULTS = 200;
const MAX_SEARCH_FILES = 3_000;
const MAX_SEARCH_MATCHES = 100;
const DEFAULT_EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/coverage/**}';

interface ReadFileInput { path: string; startLine?: number; endLine?: number }

export const readFileTool: NovaTool<ReadFileInput> = {
    name: 'read_file',
    description: 'Read a text file from the workspace. Optionally pass 1-based startLine/endLine to read part of a large file. Always read a file before editing it.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Workspace-relative path of the file.' },
            startLine: { type: 'integer', minimum: 1, description: 'First line to read (1-based, inclusive).' },
            endLine: { type: 'integer', minimum: 1, description: 'Last line to read (1-based, inclusive).' }
        },
        required: ['path']
    },
    readOnly: true,
    async prepare(input) {
        return { title: `Read ${displayPath(resolveWorkspacePath(input.path))}` };
    },
    async invoke(input) {
        const uri = resolveWorkspacePath(input.path);
        let text: string;
        try {
            text = await readText(uri);
        } catch {
            throw new ToolInputError(`File "${input.path}" does not exist or cannot be read.`);
        }

        const lines = text.split(/\r?\n/);
        const start = Math.max(1, Math.floor(input.startLine ?? 1));
        const end = Math.min(lines.length, Math.floor(input.endLine ?? start + MAX_READ_LINES - 1), start + MAX_READ_LINES - 1);
        const slice = lines.slice(start - 1, end).join('\n');
        const range = start === 1 && end === lines.length ? `${lines.length} lines` : `lines ${start}-${end} of ${lines.length}`;
        const more = end < lines.length ? `\n[Use startLine=${end + 1} to read more.]` : '';
        return `File: ${displayPath(uri)} (${range})\n${truncateMiddle(slice, MAX_READ_CHARS)}${more}`;
    }
};

interface ListDirInput { path?: string }

export const listDirTool: NovaTool<ListDirInput> = {
    name: 'list_dir',
    description: 'List the files and folders in a workspace directory. Folders end with "/".',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace-relative directory; defaults to the workspace root.' } }
    },
    readOnly: true,
    async prepare(input) {
        return { title: `List ${input.path?.trim() || 'workspace root'}` };
    },
    async invoke(input) {
        const uri = input.path?.trim() ? resolveWorkspacePath(input.path) : workspaceFolders()[0]?.uri;
        if (!uri) {
            throw new ToolInputError('No workspace folder is open.');
        }
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(uri);
        } catch {
            throw new ToolInputError(`Directory "${input.path ?? '.'}" does not exist.`);
        }
        return entries
            .sort(([leftName, leftType], [rightName, rightType]) =>
                (rightType & vscode.FileType.Directory) - (leftType & vscode.FileType.Directory) || leftName.localeCompare(rightName))
            .map(([name, type]) => (type & vscode.FileType.Directory ? `${name}/` : name))
            .join('\n') || '(empty directory)';
    }
};

interface FindFilesInput { pattern: string }

export const findFilesTool: NovaTool<FindFilesInput> = {
    name: 'find_files',
    description: 'Find workspace files by glob pattern, e.g. "**/*.test.ts" or "src/**/config*". Build output and node_modules are excluded.',
    inputSchema: {
        type: 'object',
        properties: { pattern: { type: 'string', description: 'Glob pattern relative to the workspace root.' } },
        required: ['pattern']
    },
    readOnly: true,
    async prepare(input) {
        return { title: `Find files ${input.pattern}` };
    },
    async invoke(input, context) {
        if (typeof input.pattern !== 'string' || !input.pattern.trim()) {
            throw new ToolInputError('A glob "pattern" is required.');
        }
        const files = await vscode.workspace.findFiles(input.pattern.trim(), DEFAULT_EXCLUDE, MAX_FIND_RESULTS + 1, context.token);
        const listed = files.slice(0, MAX_FIND_RESULTS).map(displayPath).sort();
        const more = files.length > MAX_FIND_RESULTS ? `\n[More than ${MAX_FIND_RESULTS} results; use a narrower pattern.]` : '';
        return listed.length ? `${listed.join('\n')}${more}` : 'No files found.';
    }
};

interface SearchTextInput { query: string; isRegex?: boolean; include?: string }

export const searchTextTool: NovaTool<SearchTextInput> = {
    name: 'search_text',
    description: 'Search file contents in the workspace. Returns matching lines as path:line: text. Use include to limit to a glob, e.g. "src/**/*.ts".',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Text or regular expression to search for.' },
            isRegex: { type: 'boolean', description: 'Treat query as a regular expression. Defaults to false.' },
            include: { type: 'string', description: 'Glob of files to search. Defaults to all files.' }
        },
        required: ['query']
    },
    readOnly: true,
    async prepare(input) {
        return { title: `Search "${input.query}"` };
    },
    async invoke(input, context) {
        if (typeof input.query !== 'string' || !input.query) {
            throw new ToolInputError('A "query" is required.');
        }

        let pattern: RegExp;
        try {
            pattern = new RegExp(input.isRegex ? input.query : escapeRegExp(input.query), 'i');
        } catch (error) {
            throw new ToolInputError(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
        }

        const files = await vscode.workspace.findFiles(input.include?.trim() || '**/*', DEFAULT_EXCLUDE, MAX_SEARCH_FILES, context.token);
        const matches: string[] = [];
        for (const file of files) {
            if (context.token.isCancellationRequested || matches.length >= MAX_SEARCH_MATCHES) {
                break;
            }
            let text: string;
            try {
                const bytes = await vscode.workspace.fs.readFile(file);
                if (bytes.length > 1_000_000 || bytes.includes(0)) {
                    continue; // large or binary
                }
                text = new TextDecoder().decode(bytes);
            } catch {
                continue;
            }

            const lines = text.split(/\r?\n/);
            for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_MATCHES; index++) {
                if (pattern.test(lines[index])) {
                    matches.push(`${displayPath(file)}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
                }
            }
        }

        const more = matches.length >= MAX_SEARCH_MATCHES ? `\n[Stopped after ${MAX_SEARCH_MATCHES} matches; refine the query or include.]` : '';
        return matches.length ? `${matches.join('\n')}${more}` : 'No matches found.';
    }
};

interface DiagnosticsInput { path?: string }

export const getDiagnosticsTool: NovaTool<DiagnosticsInput> = {
    name: 'get_diagnostics',
    description: 'Get compile errors and warnings (VS Code problems) for a file, or for the whole workspace when no path is given. Use after editing to verify changes.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace-relative file path. Omit for all files.' } }
    },
    readOnly: true,
    async prepare(input) {
        return { title: input.path ? `Check problems in ${input.path}` : 'Check problems' };
    },
    async invoke(input) {
        const entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]> = input.path?.trim()
            ? [[resolveWorkspacePath(input.path), vscode.languages.getDiagnostics(resolveWorkspacePath(input.path))]]
            : vscode.languages.getDiagnostics();

        const lines: string[] = [];
        for (const [uri, diagnostics] of entries) {
            for (const diagnostic of diagnostics) {
                if (diagnostic.severity > vscode.DiagnosticSeverity.Warning) {
                    continue;
                }
                const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
                lines.push(`${displayPath(uri)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} ${severity}: ${diagnostic.message}`);
            }
        }
        return lines.length ? lines.slice(0, 200).join('\n') : 'No errors or warnings.';
    }
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
