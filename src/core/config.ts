import * as vscode from 'vscode';
import type { CustomAgentDefinition } from './types';

export function isDiagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration('nova').get<boolean>('enableDiagnostics', false);
}

export function shouldParseModelCapabilities(): boolean {
  return vscode.workspace.getConfiguration('nova').get<boolean>('developer.parseModelCapabilities', true);
}

export function getCustomAgents(): CustomAgentDefinition[] {
  const configured = vscode.workspace.getConfiguration('nova').get<unknown[]>('chat.customAgents', []);
  if (!Array.isArray(configured)) {
    return [];
  }

  return configured.flatMap((item) => {
    const parsed = parseCustomAgent(item);
    return parsed ? [parsed] : [];
  });
}

function parseCustomAgent(value: unknown): CustomAgentDefinition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = stringField(value.id);
  const label = stringField(value.label);
  const systemPrompt = stringField(value.systemPrompt);
  if (!id || !label || !systemPrompt) {
    return undefined;
  }

  const mode = stringField(value.mode);
  return {
    id,
    label,
    description: stringField(value.description),
    systemPrompt,
    defaultModelId: stringField(value.defaultModelId),
    mode: mode === 'agent' || mode === 'ask' || mode === 'plan' ? mode : undefined,
    toolsEnabled: typeof value.toolsEnabled === 'boolean' ? value.toolsEnabled : undefined
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
