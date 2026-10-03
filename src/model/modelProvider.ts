import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type {
    ChatCompletionRequest,
    ChatMessage,
    ModelResponse,
    NovaAI
} from '@datalabrotterdam/nova-sdk';
import { getThinkingPartConstructor, isProposalEnabled } from '../core/apiSupport';
import { COMMAND_MANAGE, DEFAULT_MAX_OUTPUT_TOKENS, EXTENSION_ID, MODEL_CACHE_TTL_MS, NOVA_THINKING_MIME_TYPE, NOVA_USAGE_MIME_TYPE } from '../core/constants';
import { getDefaultContextWindow, getEditTools, isAutoCompactEnabled, shouldParseModelCapabilities, shouldRewriteAssistantIdentity } from '../core/config';
import { Diagnostics } from '../core/diagnostics';
import { isContextOverflow, isEmptyResponse, isToolCallingRejected, mapNovaError, parseContextLimit } from '../core/errors';
import { estimateMessagesTokens, fitToBudget, tokenCalibration } from '../agent/ContextManager';
import { SessionService } from '../services/SessionService';
import { estimateTextTokens, estimateTokenCount } from './tokenEstimator';
import type { LanguageModelInfo } from '../core/types';
import { StatusBar } from '../status/StatusBar';
import { rewriteIdentity } from './identity';
import { toNovaMessages } from './messages';
import { ChatStreamParser } from './streamParser';
import { createToolPayload, MAX_TOOLS, ToolNameMap } from './toolSchema';

/** `LanguageModelChatMessageRole.System` from the `languageModelSystem` proposal. */
const SYSTEM_ROLE = 3;

interface ModelCache {
    models: LanguageModelInfo[];
    expiresAt: number;
}

interface StreamResult {
    promptTokens: number;
    completionTokens: number;
}

export class ModelProvider implements vscode.LanguageModelChatProvider<LanguageModelInfo> {
    private readonly didChangeModelsEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeLanguageModelChatInformation = this.didChangeModelsEmitter.event;
    private cache?: ModelCache;
    /** Context windows reported by Nova in overflow errors, which override advertised ones. */
    private readonly learnedContextWindows = new Map<string, number>();

    public constructor(
        private readonly sessionService: SessionService,
        private readonly diagnostics: Diagnostics,
        private readonly statusBar?: StatusBar
    ) {
        this.sessionService.onDidChangeAccount(() => {
            this.cache = undefined;
            this.didChangeModelsEmitter.fire();
        });
    }

    public async warmup(): Promise<void> {
        if (!(await this.sessionService.isSignedIn())) {
            return;
        }

        try {
            await this.getModels(false);
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

    /** Chat models for Nova's own surfaces (the chat panel); empty when signed out or unreachable. */
    public async listModels(): Promise<LanguageModelInfo[]> {
        if (!(await this.sessionService.isSignedIn())) {
            return [];
        }
        try {
            return await this.getModels(true);
        } catch (error) {
            this.diagnostics.error('Nova model discovery failed.', error);
            return [];
        }
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

        return this.getModels(options.silent);
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

        const toolTokens = options.tools?.length ? estimateTextTokens(JSON.stringify(options.tools)) : 0;
        const budget = Math.max(1_024, model.maxInputTokens - toolTokens);

        try {
            await this.respond(client, model, await this.fitMessages(model, messages, budget, false), options, toolTokens, progress, token);
        } catch (error) {
            if (!isContextOverflow(error) || token.isCancellationRequested) {
                throw error;
            }

            // Our estimate was too optimistic or the advertised window is wrong: learn the real
            // limit when the server reports it, trim harder and retry once.
            const limit = parseContextLimit(error);
            if (limit) {
                this.learnContextLimit(model, limit);
            }
            const retryBudget = Math.max(1_024, Math.floor(
                (limit ? Math.min(budget, limit - model.maxOutputTokens - toolTokens) : budget) * 0.75
            ));
            this.diagnostics.trace('Nova context overflow, trimming and retrying once.', { modelId: model.id, limit, retryBudget });
            await this.respond(client, model, await this.fitMessages(model, messages, retryBudget, true), options, toolTokens, progress, token);
        }
    }

    private async respond(
        client: NovaAI,
        model: LanguageModelInfo,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        toolTokens: number,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const internal = options.requestInitiator === EXTENSION_ID;
        const useTools = Boolean(options.tools?.length) && this.sessionService.getModelToolSupport(model.id) !== 'unsupported';
        const tools = useTools ? createToolPayload(options) : { payload: {}, names: new ToolNameMap(), dropped: [] };
        const translate = (toolNames?: ToolNameMap) => {
            const translated = toNovaMessages(messages, { supportsImages: model.capabilities.imageInput === true, toolNames });
            return shouldRewriteAssistantIdentity() && options.requestInitiator !== EXTENSION_ID
                ? rewriteIdentity(translated)
                : translated;
        };
        const novaMessages = translate(tools.names);

        this.diagnostics.trace('Nova chat request started.', {
            modelId: model.id,
            toolMode: options.toolMode,
            requestInitiator: options.requestInitiator,
            tools: options.tools?.slice(0, tools.names.size).map((tool) => tool.name) ?? [],
            droppedTools: tools.dropped,
            messages: describeMessages(novaMessages)
        });

        const request: ChatCompletionRequest & Record<string, unknown> = {
            model: model.id,
            messages: novaMessages,
            stream_options: { include_usage: true },
            ...createModelOptionsPayload(model, options.modelOptions, options.modelConfiguration),
            ...tools.payload
        };

        const contextWindow = model.maxInputTokens + model.maxOutputTokens;
        const estimatedTokens = estimateMessagesTokens(messages) + toolTokens;
        const report = (result: StreamResult) => {
            if (result.promptTokens > 0) {
                tokenCalibration.record(model.id, estimatedTokens, result.promptTokens);
                this.statusBar?.updateActualUsage(result.promptTokens, contextWindow, model.name);
            }
        };

        if (!useTools) {
            report(await this.send(client, request, tools.names, model, progress, token, internal));
            return;
        }

        try {
            report(await this.sendWithEmptyRetry(client, request, tools.names, model, progress, token, internal));
            await this.sessionService.setModelToolSupport(model.id, 'supported');
        } catch (error) {
            const toolsRejected = isToolCallingRejected(error);
            if (!toolsRejected && !isEmptyResponse(error)) {
                throw mapNovaError(error);
            }

            this.diagnostics.trace('Nova tool-calling failed, retrying without tools.', {
                modelId: model.id,
                reason: toolsRejected ? 'rejected' : 'empty-response'
            });

            if (toolsRejected) {
                await this.markToolsUnsupported(model.id);
            }

            if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
                throw new Error(`Nova AI model ${model.name} does not support the tool calling this request requires.`);
            }

            const fallbackRequest: ChatCompletionRequest & Record<string, unknown> = {
                model: model.id,
                messages: translate(),
                stream_options: { include_usage: true },
                ...createModelOptionsPayload(model, options.modelOptions, options.modelConfiguration)
            };
            report(await this.send(client, fallbackRequest, new ToolNameMap(), model, progress, token, internal));
        }
    }

    /**
     * Safety net for requests that exceed the input budget: VS Code compacts its own
     * conversations, so this only prunes old tool results and drops the oldest turns,
     * without an extra model call. The system prompt and first user message are kept.
     */
    private async fitMessages(
        model: LanguageModelInfo,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        budget: number,
        force: boolean
    ): Promise<readonly vscode.LanguageModelChatRequestMessage[]> {
        if (!force && !isAutoCompactEnabled()) {
            return messages;
        }

        const leadingSystem = messages.findIndex((message) => (message.role as number) !== SYSTEM_ROLE);
        const fitted = await fitToBudget(
            messages,
            (role, content) => ({ role, content, name: undefined }) as vscode.LanguageModelChatRequestMessage,
            { budget, threshold: force ? 0 : 1, pinned: Math.min(messages.length, (leadingSystem < 0 ? messages.length : leadingSystem) + 1) },
            tokenCalibration.ratio(model.id)
        );

        if (fitted.stage !== 'none') {
            this.diagnostics.trace('Nova request compacted to fit the context window.', {
                modelId: model.id,
                stage: fitted.stage,
                budget,
                messages: `${messages.length} -> ${fitted.messages.length}`,
                estimatedTokens: fitted.estimatedTokens
            });
        }
        return fitted.messages;
    }

    /** Applies a context window reported by the server to the model's limits. */
    private learnContextLimit(model: LanguageModelInfo, contextWindow: number): void {
        this.learnedContextWindows.set(model.id, contextWindow);
        if (this.cache) {
            this.cache = {
                ...this.cache,
                models: this.cache.models.map((cached) => cached.id === model.id ? this.withLearnedCapabilities(cached) : cached)
            };
            this.didChangeModelsEmitter.fire();
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
            const sorted = response.data
                .filter((model) => model.enabled !== false && isChatModel(model))
                .map((model) => this.withLearnedCapabilities(toModelInfo(model)))
                .sort(sortModels);
            const defaultIndex = sorted.findIndex((model) => Boolean(model.capabilities.toolCalling));
            const models = sorted.map((model, index) => ({
                ...model,
                isDefault: index === defaultIndex
            }));
            this.diagnostics.trace('Nova language models discovered.', models.map((model) => ({
                id: model.id,
                maxInputTokens: model.maxInputTokens,
                maxOutputTokens: model.maxOutputTokens,
                contextWindow: model.maxInputTokens + model.maxOutputTokens,
                capabilities: model.capabilities,
                advertised: { capabilities: model.raw.capabilities, tags: model.raw.tags }
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

    /**
     * Models that do not advertise tool calling are offered as tool-capable until Nova
     * rejects tools for them, so they show up in agent mode. What was learned is stored per model.
     */
    private withLearnedCapabilities(model: LanguageModelInfo): LanguageModelInfo {
        let result = model;

        const contextWindow = this.learnedContextWindows.get(model.id);
        if (contextWindow && contextWindow !== model.maxContextWindowTokens) {
            result = { ...result, ...splitContextWindow(contextWindow, Math.min(model.maxOutputTokens, contextWindow - 1)), maxContextWindowTokens: contextWindow };
        }

        if (result.capabilities.toolCalling === undefined) {
            const supported = this.sessionService.getModelToolSupport(model.id) !== 'unsupported';
            result = { ...result, capabilities: { ...result.capabilities, toolCalling: supported ? MAX_TOOLS : false } };
        }

        return result;
    }

    private async markToolsUnsupported(modelId: string): Promise<void> {
        await this.sessionService.setModelToolSupport(modelId, 'unsupported');
        if (this.cache) {
            this.cache = {
                ...this.cache,
                models: this.cache.models.map((model) => model.id === modelId
                    ? { ...model, capabilities: { ...model.capabilities, toolCalling: false } }
                    : model)
            };
            this.didChangeModelsEmitter.fire();
        }
    }

    /** An empty response with tools is often transient: retry once before giving up on tools. */
    private async sendWithEmptyRetry(
        client: NovaAI,
        request: ChatCompletionRequest & Record<string, unknown>,
        toolNames: ToolNameMap,
        model: LanguageModelInfo,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
        internal: boolean
    ): Promise<StreamResult> {
        try {
            return await this.send(client, request, toolNames, model, progress, token, internal);
        } catch (error) {
            if (!isEmptyResponse(error) || token.isCancellationRequested) {
                throw error;
            }
            this.diagnostics.trace('Nova returned an empty response, retrying once.', { modelId: model.id });
            return this.send(client, request, toolNames, model, progress, token, internal);
        }
    }

    private async send(
        client: NovaAI,
        request: ChatCompletionRequest & Record<string, unknown>,
        toolNames: ToolNameMap,
        model: LanguageModelInfo,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
        internal: boolean
    ): Promise<StreamResult> {
        const abortController = new AbortController();
        const subscription = token.onCancellationRequested(() => abortController.abort());
        const ThinkingPart = getThinkingPartConstructor();
        const parser = new ChatStreamParser(
            { callIdPrefix: `nova-${randomUUID().slice(0, 8)}`, toolNames },
            {
                text: (value) => progress.report(new vscode.LanguageModelTextPart(value)),
                thinking: (value) => {
                    if (ThinkingPart) {
                        progress.report(new ThinkingPart(value) as vscode.LanguageModelResponsePart);
                    } else if (internal) {
                        // Nova's own chat panel shows reasoning even where the thinking proposal is off.
                        progress.report(vscode.LanguageModelDataPart.text(value, NOVA_THINKING_MIME_TYPE));
                    }
                },
                toolCall: (callId, name, input) => progress.report(new vscode.LanguageModelToolCallPart(callId, name, input))
            }
        );
        let promptTokens = 0;
        let completionTokens = 0;

        this.diagnostics.trace('Nova stream opened.', { model: request.model });

        try {
            for await (const event of client.chat.completions.stream(request, { signal: abortController.signal })) {
                if (event.type !== 'chunk') {
                    continue;
                }
                if (event.data.usage) {
                    promptTokens = event.data.usage.prompt_tokens ?? promptTokens;
                    completionTokens = event.data.usage.completion_tokens ?? completionTokens;
                }
                parser.pushChunk(event.data);
            }

            parser.end();

            if (promptTokens > 0 || completionTokens > 0) {
                progress.report(vscode.LanguageModelDataPart.json(
                    { promptTokens, completionTokens, outputBuffer: model.maxOutputTokens },
                    NOVA_USAGE_MIME_TYPE
                ));
            }
        } catch (error) {
            if (abortController.signal.aborted) {
                this.diagnostics.trace('Nova stream aborted by cancellation token.');
                throw new Error('Nova AI request was cancelled.');
            }
            this.diagnostics.trace('Nova stream error.', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        } finally {
            subscription.dispose();
        }

        this.diagnostics.trace('Nova stream closed.', {
            receivedText: parser.receivedText,
            receivedToolCalls: parser.receivedToolCalls,
            invalidToolCalls: parser.invalidToolCalls,
            finishReasons: parser.finishReasons,
            promptTokens,
            completionTokens
        });

        if (!parser.receivedText && !parser.receivedToolCalls) {
            throw Object.assign(
                new Error('The model returned an empty response. The model may be overloaded or the request may be malformed — try again.'),
                { isEmptyResponse: true }
            );
        }

        return { promptTokens, completionTokens };
    }
}

/** Shape of the translated request for diagnostics: roles and sizes, never content. */
function describeMessages(messages: readonly ChatMessage[]): unknown[] {
    return messages.map((message) => ({
        role: message.role,
        chars: typeof message.content === 'string' ? message.content.length : Array.isArray(message.content) ? `${message.content.length} parts` : 0,
        ...(Array.isArray(message.tool_calls) ? { toolCalls: message.tool_calls.length } : {}),
        ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {})
    }));
}

const CHAT_CAPABILITIES = [
    'text', 'chat', 'completion', 'completions', 'chat-completion', 'chat_completion', 'text-generation', 'text_generation',
    'tool', 'tools', 'tool-calling', 'tool_calling', 'function-calling', 'function_calling', 'reasoning'
];

/**
 * Nova also serves embedding, speech (`audio_synthesis`) and transcription (`audio_transcription`)
 * models, which cannot chat. When a model advertises capabilities, one of them must be a chat
 * capability; models without capability information are kept.
 */
function isChatModel(model: ModelResponse): boolean {
    const capabilities = getCapabilitySet(model);
    return !capabilities.size || hasAnyCapability(capabilities, CHAT_CAPABILITIES);
}

function sortModels(left: LanguageModelInfo, right: LanguageModelInfo): number {
    return left.name.localeCompare(right.name);
}

function toModelInfo(model: ModelResponse): LanguageModelInfo {
    const family = firstString(model, ['family', 'name']) ?? model.id;
    const advertisedContextWindow = firstNumber(model, [
        'context_window',
        'max_model_len',
        'contextWindow',
        'maxModelLen',
        'context_length',
        'contextLength'
    ]);
    const contextWindow = advertisedContextWindow ?? getDefaultContextWindow();
    const explicitMaxOutputTokens = firstNumber(model, [
        'max_output_tokens',
        'maxOutputTokens',
        'max_completion_tokens',
        'maxCompletionTokens',
        'output_token_limit',
        'outputTokenLimit'
    ]);
    // Use 25% of context window for output (not 50%) to leave more room for input.
    // VS Code reserves the full maxOutputTokens slot, so models with small context windows
    // would otherwise run out of input tokens for actual user prompts. When the window is
    // only assumed, an advertised output limit is capped the same way.
    const quarterWindow = Math.max(1, Math.floor(contextWindow / 4));
    const requestedMaxOutputTokens = advertisedContextWindow
        ? explicitMaxOutputTokens ?? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, quarterWindow)
        : Math.min(explicitMaxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, quarterWindow);
    const explicitMaxInputTokens = firstNumber(model, [
        'max_input_tokens',
        'maxInputTokens',
        'input_token_limit',
        'inputTokenLimit'
    ]);
    const limits = splitContextWindow(contextWindow, requestedMaxOutputTokens);
    const maxOutputTokens = limits.maxOutputTokens;
    const maxInputTokens = explicitMaxInputTokens ?? limits.maxInputTokens;

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
        isDefault: false,
        isUserSelectable: true,
        capabilities: {
            ...createModelCapabilities(model),
            ...(isProposalEnabled('chatProvider') ? { editTools: getEditTools() } : {})
        },
        ...proposedModelInfo(model, contextWindow, maxOutputTokens)
    };
}

/**
 * Model fields from API proposals. Only sent when VS Code enabled the proposal: stable VS Code
 * rejects the whole model list when, for example, `editTools` is set without `chatProvider`.
 */
function proposedModelInfo(model: ModelResponse, contextWindow: number, maxOutputTokens: number): Partial<LanguageModelInfo> {
    const info: { -readonly [K in keyof LanguageModelInfo]?: LanguageModelInfo[K] } = {};
    if (isProposalEnabled('chatProvider')) {
        info.maxContextWindowTokens = contextWindow;
        info.configurationSchema = createConfigurationSchema(maxOutputTokens);
    }
    if (isProposalEnabled('languageModelPricing')) {
        info.pricing = createPricingLabel(model);
    }
    return info;
}

/**
 * Splits a context window into input and output budgets, reserving 2% (at least 1,024 tokens)
 * as headroom for chat-template overhead and token-estimation error.
 */
function splitContextWindow(contextWindow: number, requestedMaxOutputTokens: number): { maxInputTokens: number; maxOutputTokens: number } {
    const maxOutputTokens = Math.min(requestedMaxOutputTokens, Math.max(1, contextWindow - 1));
    const contextSafetyMargin = Math.max(1_024, Math.ceil(contextWindow * 0.02));
    return {
        maxOutputTokens,
        maxInputTokens: Math.max(1, contextWindow - maxOutputTokens - contextSafetyMargin)
    };
}

function createPricingLabel(model: ModelResponse): string | undefined {
    const input = firstNumber(model, ['input_cost_per_1m']);
    const output = firstNumber(model, ['output_cost_per_1m']);
    if (input === undefined && output === undefined) {
        return undefined;
    }

    const currency = firstString(model, ['currency']) ?? 'EUR';
    const format = (value: number | undefined) => value === undefined
        ? '?'
        : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 4 }).format(value);
    return `${format(input)} in / ${format(output)} out per 1M tokens`;
}

/** Per-model options users can set in VS Code's language models configuration. */
function createConfigurationSchema(maxOutputTokens: number): LanguageModelInfo['configurationSchema'] {
    return {
        properties: {
            temperature: {
                type: 'number',
                minimum: 0,
                maximum: 2,
                description: 'Sampling temperature. Lower is more deterministic.'
            },
            reasoningEffort: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Reasoning effort for models that support it.'
            },
            maxOutputTokens: {
                type: 'integer',
                minimum: 1,
                maximum: maxOutputTokens,
                description: 'Maximum number of tokens to generate.'
            }
        }
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

/** Tool calling is left undefined so the provider can apply what it learned for the model. */
function defaultModelCapabilities(): vscode.LanguageModelChatCapabilities {
    return {
        toolCalling: undefined,
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

function createModelOptionsPayload(
    model: LanguageModelInfo,
    modelOptions: vscode.ProvideLanguageModelChatResponseOptions['modelOptions'],
    modelConfiguration?: vscode.ProvideLanguageModelChatResponseOptions['modelConfiguration']
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        ...configurationPayload(modelConfiguration),
        ...(isRecord(modelOptions) ? modelOptions : {})
    };
    if (!hasOutputTokenLimit(payload)) {
        payload.max_tokens = model.maxOutputTokens;
    }
    return payload;
}

function configurationPayload(configuration: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!configuration) {
        return {};
    }

    const payload: Record<string, unknown> = {};
    if (typeof configuration.temperature === 'number') {
        payload.temperature = configuration.temperature;
    }
    if (typeof configuration.reasoningEffort === 'string') {
        payload.reasoning_effort = configuration.reasoningEffort;
    }
    if (typeof configuration.maxOutputTokens === 'number') {
        payload.max_tokens = configuration.maxOutputTokens;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Pricing label for Nova's own UI; independent of the `languageModelPricing` proposal. */
export function pricingLabel(model: LanguageModelInfo): string | undefined {
    return model.pricing ?? createPricingLabel(model.raw);
}

export const providerInternals = {
    createModelOptionsPayload,
    isChatModel,
    toModelInfo
};
