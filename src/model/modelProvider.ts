import * as vscode from 'vscode';
import type {
    ChatCompletionRequest,
    ChatMessage,
    ChatStreamEvent,
    ModelResponse,
    NovaAI
} from '@datalabrotterdam/nova-sdk';
import {COMMAND_MANAGE, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, MODEL_CACHE_TTL_MS} from '../core/constants';
import {shouldParseModelCapabilities} from '../core/config';
import {Diagnostics} from '../core/diagnostics';
import {isToolCallingRejected, mapNovaError} from '../core/errors';
import {SessionService} from '../services/SessionService';
import {estimateTokenCount} from './tokenEstimator';
import type {LanguageModelInfo, ToolCallingSupport} from '../core/types';
import {StatusBar} from '../status/StatusBar';

interface ModelCache {
    models: LanguageModelInfo[];
    expiresAt: number;
}

interface PendingToolCall {
    id: string;
    name: string;
    argumentsText: string;
}

export class ModelProvider implements vscode.LanguageModelChatProvider<LanguageModelInfo> {
    private readonly didChangeModelsEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeLanguageModelChatInformation = this.didChangeModelsEmitter.event;
    private cache?: ModelCache;

    public constructor(
        private readonly sessionService: SessionService,
        private readonly diagnostics: Diagnostics,
        private readonly statusBar?: StatusBar
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

    public async refreshModels(): Promise<LanguageModelInfo[]> {
        this.cache = undefined;
        const models = await this.getModels(false);
        this.didChangeModelsEmitter.fire();
        return models;
    }

    public async getCachedModels(): Promise<readonly LanguageModelInfo[]> {
        return this.cache?.models ?? [];
    }

    public async provideLanguageModelChatInformation(
        options: vscode.PrepareLanguageModelChatModelOptions,
        token: vscode.CancellationToken
    ): Promise<LanguageModelInfo[]> {
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
        model: LanguageModelInfo,
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
        this.statusBar?.updateRequest(messages, options.tools, model);

        const request: ChatCompletionRequest & Record<string, unknown> = {
            model: model.id,
            messages: toNovaMessages(messages),
            ...createModelOptionsPayload(model, options.modelOptions),
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
                    messages: toNovaMessages(messages),
                    ...createModelOptionsPayload(model, options.modelOptions)
                };
                await this.streamResponse(client, fallbackRequest, progress, token);
                return;
            }

            throw mapNovaError(error);
        }
    }

    public async provideTokenCount(
        model: LanguageModelInfo,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken
    ): Promise<number> {
        const count = estimateTokenCount(text);
        this.diagnostics.trace('Nova token count requested.', {
            modelId: model.id,
            inputKind: typeof text === 'string' ? 'string' : 'message',
            tokens: count
        });
        return count;
    }

    private async getModels(silent: boolean): Promise<LanguageModelInfo[]> {
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
            this.diagnostics.trace('Nova language models discovered.', models.map((model) => ({
                id: model.id,
                maxInputTokens: model.maxInputTokens,
                maxOutputTokens: model.maxOutputTokens,
                contextWindow: model.maxInputTokens + model.maxOutputTokens,
                capabilities: model.capabilities
            })));

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

    private async ensureToolCallingSupport(models: readonly LanguageModelInfo[]): Promise<void> {
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
                messages: [{role: 'user', content: 'Reply with ok.'}],
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
            for await (const event of client.chat.completions.stream(request, {signal: abortController.signal})) {
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

function sortModels(left: LanguageModelInfo, right: LanguageModelInfo): number {
    return left.name.localeCompare(right.name);
}

function toModelInfo(model: ModelResponse): LanguageModelInfo {
    const family = firstString(model, ['family', 'name']) ?? model.id;
    const contextWindow = firstNumber(model, [
        'context_window',
        'max_model_len',
        'contextWindow',
        'maxModelLen',
        'context_length',
        'contextLength'
    ]);
    const explicitMaxOutputTokens = firstNumber(model, [
        'max_output_tokens',
        'maxOutputTokens',
        'max_completion_tokens',
        'maxCompletionTokens',
        'output_token_limit',
        'outputTokenLimit'
    ]);
    const requestedMaxOutputTokens = explicitMaxOutputTokens
        ?? (contextWindow ? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(contextWindow / 2))) : DEFAULT_MAX_OUTPUT_TOKENS);
    const maxOutputTokens = contextWindow
        ? Math.min(requestedMaxOutputTokens, Math.max(1, contextWindow - 1))
        : requestedMaxOutputTokens;
    const explicitMaxInputTokens = firstNumber(model, [
        'max_input_tokens',
        'maxInputTokens',
        'input_token_limit',
        'inputTokenLimit'
    ]);
    const maxInputTokens = explicitMaxInputTokens
        ?? (contextWindow ? Math.max(1, contextWindow - maxOutputTokens) : DEFAULT_MAX_INPUT_TOKENS);

    return {
        id: model.id,
        raw: model,
        name: firstString(model, ['name']) ?? model.id,
        family,
        version: String(model.created ?? 'latest'),
        tooltip: createModelTooltip(model, maxInputTokens, maxOutputTokens),
        detail: createModelDetail(model),
        maxInputTokens,
        maxOutputTokens,
        capabilities: createModelCapabilities(model)
    };
}

function createModelTooltip(model: ModelResponse, maxInputTokens: number, maxOutputTokens: number): string {
    const parts = [
        `Nova AI model ${model.id}`,
        firstString(model, ['description']),
        `Input: ${formatTokenCount(maxInputTokens)} tokens`,
        `Output: ${formatTokenCount(maxOutputTokens)} tokens`
    ];

    return parts.filter(Boolean).join('\n');
}

function formatTokenCount(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function createModelDetail(model: ModelResponse): string {
    const tags = Array.isArray(model.tags)
        ? model.tags.map(String).filter(Boolean)
        : [];
    const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.map(String).filter(Boolean)
        : [];
    const details = [
        model.owned_by,
        firstString(model, ['variant']),
        ...tags,
        ...capabilities
    ];

    return Array.from(new Set(details.filter((value): value is string => Boolean(value)))).join(' | ');
}

function createModelCapabilities(model: ModelResponse): vscode.LanguageModelChatCapabilities {
    if (!shouldParseModelCapabilities()) {
        return defaultModelCapabilities();
    }

    const capabilities = getCapabilitySet(model);
    if (!capabilities.size) {
        return defaultModelCapabilities();
    }

    return {
        toolCalling: hasAnyCapability(capabilities, [
            'tool',
            'tools',
            'tool-calling',
            'tool_calling',
            'function-calling',
            'function_calling',
            'functions'
        ]),
        imageInput: hasAnyCapability(capabilities, [
            'image',
            'images',
            'image-input',
            'image_input',
            'vision',
            'multimodal'
        ])
    };
}

function defaultModelCapabilities(): vscode.LanguageModelChatCapabilities {
    return {
        toolCalling: false,
        imageInput: false
    };
}

function getCapabilitySet(model: ModelResponse): Set<string> {
    const values = Array.isArray(model.capabilities) ? model.capabilities : [];
    return new Set(values.map(normalizeCapability).filter(Boolean));
}

function normalizeCapability(value: unknown): string {
    return String(value).trim().toLowerCase();
}

function hasAnyCapability(capabilities: ReadonlySet<string>, candidates: string[]): boolean {
    return candidates.some((candidate) => capabilities.has(candidate));
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
    const containers = [
        model,
        isRecord(model.metadata) ? model.metadata : undefined,
        isRecord(model.capabilities) ? model.capabilities : undefined,
        isRecord(model.limits) ? model.limits : undefined
    ];

    for (const container of containers) {
        if (!container) {
            continue;
        }

        const value = firstContainerNumber(container, keys);
        if (value !== undefined) {
            return value;
        }
    }

    return undefined;
}

function firstContainerNumber(model: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = model[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
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

function createModelOptionsPayload(
    model: LanguageModelInfo,
    modelOptions: vscode.ProvideLanguageModelChatResponseOptions['modelOptions']
): Record<string, unknown> {
    const payload = isRecord(modelOptions) ? {...modelOptions} : {};
    if (!hasOutputTokenLimit(payload)) {
        payload.max_tokens = model.maxOutputTokens;
    }
    return payload;
}

function hasOutputTokenLimit(payload: Record<string, unknown>): boolean {
    return firstContainerNumber(payload, [
        'max_tokens',
        'max_output_tokens',
        'max_completion_tokens'
    ]) !== undefined;
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
            ...(assistantToolCalls.length ? {tool_calls: assistantToolCalls} : {})
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
            parsedInput = {raw: toolCall.argumentsText};
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

function getPreferredModelId(models: readonly LanguageModelInfo[], selectedModelId?: string): string {
    return selectedModelId && models.some((model) => model.id === selectedModelId)
        ? selectedModelId
        : models[0].id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export const providerInternals = {
    createModelOptionsPayload,
    createToolPayload,
    flushToolCalls,
    getPreferredModelId,
    toModelInfo,
    toNovaMessages
};
