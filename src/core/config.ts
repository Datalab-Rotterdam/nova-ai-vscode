import * as vscode from 'vscode';

export const DEFAULT_EDIT_TOOLS = ['find-replace', 'multi-find-replace'];

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('nova');
}

export function isDiagnosticsEnabled(): boolean {
  return configuration().get<boolean>('enableDiagnostics', false);
}

export function shouldParseModelCapabilities(): boolean {
  return configuration().get<boolean>('developer.parseModelCapabilities', true);
}

export function shouldRewriteAssistantIdentity(): boolean {
  return configuration().get<boolean>('chat.rewriteAssistantIdentity', true);
}

/** Edit tools VS Code agent mode should offer Nova models. */
export function getEditTools(): string[] {
  const value = configuration().get<unknown>('models.editTools', DEFAULT_EDIT_TOOLS);
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : DEFAULT_EDIT_TOOLS;
}

/** Context window assumed for models that do not advertise one. */
export function getDefaultContextWindow(): number {
  const value = configuration().get<number>('context.defaultContextWindow', 32_768);
  return Number.isFinite(value) && value >= 1_024 ? Math.floor(value) : 32_768;
}

export function isAutoCompactEnabled(): boolean {
  return configuration().get<boolean>('context.autoCompact', true);
}

/** Share of the input budget at which the conversation is compacted. */
export function getCompactThreshold(): number {
  const value = configuration().get<number>('context.compactThreshold', 0.8);
  return Number.isFinite(value) ? Math.min(0.95, Math.max(0.3, value)) : 0.8;
}

export function getMaxToolRounds(): number {
  const value = configuration().get<number>('agent.maxToolRounds', 25);
  return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value))) : 25;
}
