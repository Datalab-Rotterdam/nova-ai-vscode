import * as vscode from 'vscode';
import type { MemoryService } from '../../memory/MemoryService';
import { createMemoryTools } from './memoryTools';
import type { NovaTool } from './types';
import { fetchUrl, parseUrl, type FetchUrlInput } from './webTools';

/** Name in `contributes.languageModelTools`; referenced in chat as `#novaFetch`. */
export const NOVA_FETCH_TOOL = 'nova_fetch_url';

/**
 * Registers Nova's web tools as VS Code language model tools, so agent mode, `@nova`
 * and other chat participants can use them with any model.
 */
export function registerVsCodeTools(memory?: MemoryService): vscode.Disposable {
    const disposables = [registerFetchTool()];
    if (memory) {
        for (const tool of createMemoryTools(memory) as unknown as NovaTool<Record<string, unknown>>[]) {
            disposables.push(registerNovaTool(`nova_${tool.name}`, tool));
        }
    }
    return vscode.Disposable.from(...disposables);
}

/** Exposes a Nova tool to VS Code chat; non-read-only tools ask for confirmation. */
function registerNovaTool(name: string, tool: NovaTool<Record<string, unknown>>): vscode.Disposable {
    return vscode.lm.registerTool<Record<string, unknown>>(name, {
        async prepareInvocation(options) {
            const preparation = await tool.prepare(options.input, { token: new vscode.CancellationTokenSource().token });
            return {
                invocationMessage: preparation.title,
                ...(tool.readOnly ? {} : {
                    confirmationMessages: {
                        title: preparation.title,
                        message: new vscode.MarkdownString(preparation.detail ? `\`${preparation.detail}\`` : preparation.title)
                    }
                })
            };
        },
        async invoke(options, token) {
            const preparation = await tool.prepare(options.input, { token });
            const text = await tool.invoke(options.input, { token }, preparation);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
        }
    });
}

function registerFetchTool(): vscode.Disposable {
    return vscode.lm.registerTool<FetchUrlInput>(NOVA_FETCH_TOOL, {
        prepareInvocation(options) {
            const url = parseUrl(options.input.url);
            return {
                invocationMessage: `Fetching ${url.host}`,
                confirmationMessages: {
                    title: 'Fetch web page?',
                    message: new vscode.MarkdownString(`Nova wants to read \`${url.toString()}\`.`)
                }
            };
        },
        async invoke(options, token) {
            const text = await fetchUrl(parseUrl(options.input.url), options.input.startChar ?? 0, token);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
        }
    });
}
