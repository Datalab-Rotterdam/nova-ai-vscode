declare module 'vscode' {
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
        usage(usage: ChatResultUsage): void;
    }
}
