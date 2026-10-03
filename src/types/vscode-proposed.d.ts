/**
 * Subset of VS Code API proposals used by Nova, taken from microsoft/vscode `src/vscode-dts`
 * (checked against VS Code 1.140). Everything is declared optional because proposals are only
 * enabled in Insiders or for allowlisted extensions: always go through `src/core/apiSupport.ts`.
 */
declare module 'vscode' {
    // chatParticipantAdditions
    export interface ChatResultPromptTokenDetail {
        readonly category: string;
        readonly label: string;
        readonly percentageOfPrompt: number;
    }

    export interface ChatResultUsage {
        readonly promptTokens: number;
        readonly completionTokens: number;
        readonly outputBuffer?: number;
        readonly promptTokenDetails?: readonly ChatResultPromptTokenDetail[];
    }

    export interface ChatResponseStream {
        usage?(usage: ChatResultUsage): void;
        thinkingProgress?(delta: { text?: string | string[]; id: string; metadata?: { readonly [key: string]: unknown } }): void;
    }

    export interface ChatRequest {
        /** Tools that should (`true`) and should not (`false`) be used in this request. */
        readonly tools?: Map<LanguageModelToolInformation, boolean>;
    }

    // chatProvider
    export interface ProvideLanguageModelChatResponseOptions {
        /** Extension that initiated the request, or undefined when the editor itself did. */
        readonly requestInitiator?: string;
        /** Per-model configuration resolved from {@link LanguageModelChatInformation.configurationSchema}. */
        readonly modelConfiguration?: { readonly [key: string]: unknown };
    }

    export interface LanguageModelChatInformation {
        readonly maxContextWindowTokens?: number;
        readonly statusIcon?: ThemeIcon;
        readonly configurationSchema?: {
            readonly properties?: { readonly [key: string]: Record<string, unknown> };
        };
        readonly warningText?: Record<string, string>;
        // languageModelPricing
        readonly pricing?: string;
    }

    export interface LanguageModelChatCapabilities {
        /** Edit tools the model handles well: 'find-replace', 'multi-find-replace', 'apply-patch', 'code-rewrite'. */
        readonly editTools?: string[];
    }
}
