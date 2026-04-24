import * as vscode from 'vscode';
import type { ChatCompletionRequest, ChatMessage, ChatStreamEvent, ModelResponse, NovaAI } from '@datalabrotterdam/nova-sdk';
import { COMMAND_MANAGE, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, MODEL_CACHE_TTL_MS } from './constants';
import { getDefaultModelOverride } from './config';
import { NovaDiagnostics } from './novaDiagnostics';
import { isToolCallingRejected, mapNovaError } from './novaErrors';
import { NovaSessionService } from './novaSessionService';
import { estimateTokenCount } from './tokenEstimator';
import type { NovaLanguageModelInfo, ToolCallingSupport } from './types';

interface ModelCache {
  models: NovaLanguageModelInfo[];
  expiresAt: number;
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export class NovaModelProvider implements vscode.LanguageModelChatProvider<NovaLanguageModelInfo> {
  private readonly didChangeModelsEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this.didChangeModelsEmitter.event;
  private cache?: ModelCache;

  public constructor(
    private readonly sessionService: NovaSessionService,
    private readonly diagnostics: NovaDiagnostics
  ) {
    this.sessionService.onDidChangeSession(() => {
      this.cache = undefined;
      this.didChangeModelsEmitter.fire();
    });
  }

  public async warmup(): Promise<void> {
    if (!(await this.sessionService.isSignedIn())) {
      return;
    }

    try {
      const models = await this.getModels(false);
      await this.ensureToolCallingSupport(models);
    } catch (error) {
      this.diagnostics.error('Nova model warmup failed.', error);
    }
  }

  public async refreshModels(): Promise<NovaLanguageModelInfo[]> {
    this.cache = undefined;
    const models = await this.getModels(false);
    this.didChangeModelsEmitter.fire();
    return models;
  }

  public async getCachedModels(): Promise<readonly NovaLanguageModelInfo[]> {
    return this.cache?.models ?? [];
  }

  public async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<NovaLanguageModelInfo[]> {
    if (token.isCancellationRequested) {
      return [];
    }

    if (!(await this.sessionService.isSignedIn())) {
      if (!options.silent) {
        void vscode.commands.executeCommand(COMMAND_MANAGE);
        void vscode.window.showInformationMessage('Connect Nova AI to make its chat models available in VS Code.');
      }
      return [];
    }

    const models = await this.getModels(options.silent);
    await this.ensureToolCallingSupport(models);
    return models;
  }

  public async provideLanguageModelChatResponse(
    model: NovaLanguageModelInfo,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const client = await this.sessionService.createClient();
    if (!client) {
      throw vscode.LanguageModelError.NoPermissions('Connect Nova AI before sending requests.');
    }

    await this.sessionService.setSelectedModel(model.id);

    const request: ChatCompletionRequest & Record<string, unknown> = {
      model: model.id,
      messages: toNovaMessages(messages),
      ...createToolPayload(options)
    };

    try {
      await this.streamResponse(client, request, progress, token);
    } catch (error) {
      if (options.tools?.length && isToolCallingRejected(error)) {
        await this.sessionService.setToolCallingSupport('unsupported');

        if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
          throw new Error('Nova AI rejected required tool-calling for this model.');
        }

        const fallbackRequest: ChatCompletionRequest = {
          model: model.id,
          messages: toNovaMessages(messages)
        };
        await this.streamResponse(client, fallbackRequest, progress, token);
        return;
      }

      throw mapNovaError(error);
    }
  }

  public async provideTokenCount(
    _model: NovaLanguageModelInfo,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    return estimateTokenCount(text);
  }

  private async getModels(silent: boolean): Promise<NovaLanguageModelInfo[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.models;
    }

    const client = await this.sessionService.createClient();
    if (!client) {
      return [];
    }

    try {
      const response = await client.models.list();
      const models = response.data
        .filter((model) => model.enabled !== false)
        .map((model) => toModelInfo(model))
        .sort(sortModels);

      this.cache = {
        models,
        expiresAt: Date.now() + MODEL_CACHE_TTL_MS
      };

      return models;
    } catch (error) {
      if (!silent) {
        void vscode.window.showErrorMessage(`Nova AI model discovery failed: ${mapNovaError(error).message}`);
      }
      throw mapNovaError(error);
    }
  }

  private async ensureToolCallingSupport(models: readonly NovaLanguageModelInfo[]): Promise<void> {
    const snapshot = await this.sessionService.getSnapshot();
    if (snapshot.toolCallingSupport !== 'unknown' || !models.length) {
      return;
    }

    const client = await this.sessionService.createClient();
    if (!client) {
      return;
    }

    try {
      const stream = client.chat.completions.stream({
        model: getPreferredModelId(models, snapshot.selectedModelId),
        messages: [{ role: 'user', content: 'Reply with ok.' }],
        max_tokens: 1,
        tools: [
          {
            type: 'function',
            function: {
              name: 'noop',
              description: 'A no-op probe.',
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: 'auto'
      });

      for await (const _event of stream) {
        break;
      }

      await this.sessionService.setToolCallingSupport('supported');
    } catch (error) {
      const support: ToolCallingSupport = isToolCallingRejected(error) ? 'unsupported' : 'supported';
      await this.sessionService.setToolCallingSupport(support);
    }
  }

  private async streamResponse(
    client: NovaAI,
      request: ChatCompletionRequest & Record<string, unknown>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const abortController = new AbortController();
    const subscription = token.onCancellationRequested(() => abortController.abort());
    const pendingToolCalls = new Map<number, PendingToolCall>();

    try {
      for await (const event of client.chat.completions.stream(request, { signal: abortController.signal })) {
        this.handleStreamEvent(event, pendingToolCalls, progress);
      }

      flushToolCalls(pendingToolCalls, progress);
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error('Nova AI request was cancelled.');
      }
      throw error;
    } finally {
      subscription.dispose();
    }
  }

  private handleStreamEvent(
    event: ChatStreamEvent,
    pendingToolCalls: Map<number, PendingToolCall>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    if (event.type !== 'chunk') {
      return;
    }

    for (const choice of event.data.choices ?? []) {
      const content = choice.delta?.content;
      if (typeof content === 'string' && content.length) {
        progress.report(new vscode.LanguageModelTextPart(content));
      }

      const toolCalls = Array.isArray((choice.delta as Record<string, unknown>)?.tool_calls)
        ? ((choice.delta as Record<string, unknown>).tool_calls as Array<Record<string, unknown>>)
        : [];

      for (const toolCall of toolCalls) {
        const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
        const current = pendingToolCalls.get(index) ?? {
          id: typeof toolCall.id === 'string' ? toolCall.id : `nova-tool-${index}`,
          name: '',
          argumentsText: ''
        };

        const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
        if (fn && typeof fn.name === 'string') {
          current.name = fn.name;
        }
        if (fn && typeof fn.arguments === 'string') {
          current.argumentsText += fn.arguments;
        }

        pendingToolCalls.set(index, current);
      }

      if (choice.finish_reason === 'tool_calls') {
        flushToolCalls(pendingToolCalls, progress);
      }
    }
  }
}

function sortModels(left: NovaLanguageModelInfo, right: NovaLanguageModelInfo): number {
  return left.name.localeCompare(right.name);
}

function toModelInfo(model: ModelResponse): NovaLanguageModelInfo {
  const family = firstString(model, ['family', 'name']) ?? model.id;
  const maxOutputTokens = firstNumber(model, ['max_output_tokens', 'maxOutputTokens', 'output_token_limit']) ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxInputTokens = firstNumber(model, ['max_input_tokens', 'maxInputTokens', 'context_window', 'contextWindow']) ?? DEFAULT_MAX_INPUT_TOKENS;

  return {
    id: model.id,
    raw: model,
    name: firstString(model, ['name']) ?? model.id,
    family,
    version: String(model.created ?? 'latest'),
    tooltip: `Nova AI model ${model.id}`,
    detail: model.owned_by,
    maxInputTokens,
    maxOutputTokens,
    capabilities: {
      toolCalling: true,
      imageInput: false
    }
  };
}

function firstString(model: ModelResponse, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = model[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(model: ModelResponse, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = model[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function createToolPayload(options: vscode.ProvideLanguageModelChatResponseOptions): Record<string, unknown> {
  if (!options.tools?.length) {
    return {};
  }

  return {
    tools: options.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? {
          type: 'object',
          properties: {}
        }
      }
    })),
    tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto'
  };
}

function toNovaMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    const textParts: string[] = [];
    const assistantToolCalls: Array<Record<string, unknown>> = [];
    const toolResults: vscode.LanguageModelToolResultPart[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
        continue;
      }

      if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantToolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input)
          }
        });
        continue;
      }

      if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelDataPart) {
        textParts.push(new TextDecoder().decode(part.data));
        continue;
      }

      textParts.push(stringifyUnknown(part));
    }

    if (message.role === vscode.LanguageModelChatMessageRole.User) {
      if (textParts.length) {
        result.push({
          role: 'user',
          content: textParts.join('\n')
        });
      }

      for (const toolResult of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: toolResult.callId,
          content: toolResult.content.map(stringifyUnknown).join('\n')
        });
      }

      continue;
    }

    result.push({
      role: 'assistant',
      content: textParts.join('\n'),
      ...(assistantToolCalls.length ? { tool_calls: assistantToolCalls } : {})
    });
  }

  return result;
}

function flushToolCalls(
  pendingToolCalls: Map<number, PendingToolCall>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>
): void {
  for (const [index, toolCall] of Array.from(pendingToolCalls.entries()).sort((left, right) => left[0] - right[0])) {
    if (!toolCall.name) {
      continue;
    }

    let parsedInput: object = {};
    try {
      parsedInput = toolCall.argumentsText ? JSON.parse(toolCall.argumentsText) as object : {};
    } catch {
      parsedInput = { raw: toolCall.argumentsText };
    }

    progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, parsedInput));
    pendingToolCalls.delete(index);
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getPreferredModelId(models: readonly NovaLanguageModelInfo[], selectedModelId?: string): string {
  const override = getDefaultModelOverride();
  return override && models.some((model) => model.id === override)
    ? override
    : selectedModelId && models.some((model) => model.id === selectedModelId)
      ? selectedModelId
      : models[0].id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const providerInternals = {
  createToolPayload,
  flushToolCalls,
  getPreferredModelId,
  toModelInfo,
  toNovaMessages
};
