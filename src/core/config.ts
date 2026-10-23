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

export interface SubagentSettings {
  enabled: boolean;
  maxPerCall: number;
  maxParallel: number;
  maxTotalPerRun: number;
  maxRounds: number;
  /** Coding agents in their own worktree (start_coding_agent). */
  codingAgents: boolean;
  /** Coding agents working at the same time; more wait in a queue. */
  maxBackground: number;
  /** Tool rounds a coding agent may use. */
  codingRounds: number;
  /** "inherit" (the chat's model) or a model id. */
  model: string;
  /** Model ids the main agent may choose per task. */
  allowedModels: string[];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

/** Limits and model choice of the spawn_agents tool; every number is clamped, whatever the settings say. */
export function getSubagentSettings(): SubagentSettings {
  const config = configuration();
  const models = config.get<unknown>('agent.subagents.allowedModels', []);
  const model = config.get<string>('agent.subagents.model', 'inherit');
  return {
    enabled: config.get<boolean>('agent.subagents.enabled', true),
    maxPerCall: clampInt(config.get('agent.subagents.maxPerCall'), 4, 1, 8),
    maxParallel: clampInt(config.get('agent.subagents.maxParallel'), 3, 1, 8),
    maxTotalPerRun: clampInt(config.get('agent.subagents.maxTotalPerRun'), 8, 1, 32),
    maxRounds: clampInt(config.get('agent.subagents.maxRounds'), 12, 1, 50),
    codingAgents: config.get<boolean>('agent.codingAgents.enabled', true),
    maxBackground: clampInt(config.get('agent.codingAgents.maxParallel'), 2, 1, 8),
    codingRounds: clampInt(config.get('agent.codingAgents.maxRounds'), 60, 5, 500),
    model: typeof model === 'string' && model.trim() ? model.trim() : 'inherit',
    allowedModels: Array.isArray(models) ? models.filter((item): item is string => typeof item === 'string') : []
  };
}
