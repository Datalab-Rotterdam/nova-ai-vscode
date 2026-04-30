import { TextDecoder } from 'node:util';
import * as vscode from 'vscode';

interface ReadFileInput {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

interface FindTextInput {
  query: string;
  includePattern?: string;
}

interface ListDirectoryInput {
  path: string;
}

export function registerWorkspaceTools(): vscode.Disposable[] {
  return [
    vscode.lm.registerTool<ReadFileInput>('nova_read_file', {
      invoke: async ({ input }) => new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(await readFileContent(input))
      ])
    }),
    vscode.lm.registerTool<FindTextInput>('nova_find_text', {
      invoke: async ({ input }) => new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(await findText(input))
      ])
    }),
    vscode.lm.registerTool<ListDirectoryInput>('nova_list_directory', {
      invoke: async ({ input }) => new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(await listDirectory(input))
      ])
    })
  ];
}

async function readFileContent(input: ReadFileInput): Promise<string> {
  const target = toUri(input.filePath);
  const bytes = await vscode.workspace.fs.readFile(target);
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/);
  const startLine = Math.max(1, input.startLine ?? 1);
  const endLine = Math.min(lines.length, input.endLine ?? Math.min(lines.length, startLine + 199));
  const slice = lines.slice(startLine - 1, endLine);

  return [
    `File: ${target.fsPath}`,
    `Lines: ${startLine}-${endLine}`,
    ...slice.map((line, index) => `${startLine + index}: ${line}`)
  ].join('\n');
}

async function findText(input: FindTextInput): Promise<string> {
  const matches: string[] = [];
  const files = await vscode.workspace.findFiles(input.includePattern ?? '**/*', '**/{node_modules,dist,out,.git}/**', 200);

  for (const file of files) {
    if (matches.length >= 20) {
      break;
    }

    const bytes = await vscode.workspace.fs.readFile(file);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(input.query)) {
        continue;
      }

      matches.push(`${file.fsPath}:${index + 1}: ${lines[index].trim()}`);
      if (matches.length >= 20) {
        break;
      }
    }
  }

  if (!matches.length) {
    return `No matches found for "${input.query}".`;
  }

  return matches.join('\n');
}

async function listDirectory(input: ListDirectoryInput): Promise<string> {
  const target = toUri(input.path);
  const entries = await vscode.workspace.fs.readDirectory(target);

  if (!entries.length) {
    return `Directory ${target.fsPath} is empty.`;
  }

  return [
    `Directory: ${target.fsPath}`,
    ...entries
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([name, type]) => `${type === vscode.FileType.Directory ? 'dir' : 'file'} ${name}`)
  ].join('\n');
}

function toUri(inputPath: string): vscode.Uri {
  if (inputPath.startsWith('/')) {
    return vscode.Uri.file(inputPath);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error(`Cannot resolve relative path "${inputPath}" without an open workspace.`);
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, inputPath);
}
