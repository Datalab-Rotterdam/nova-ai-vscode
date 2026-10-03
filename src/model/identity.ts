import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import { NOVA_IDENTITY_PREAMBLE } from '../core/prompts';

/** Matches Copilot self-identification, but not tool names or paths like `copilot_readFile` or `copilot-instructions.md`. */
const COPILOT_NAME = /(?<![\w./-])(?:GitHub )?Copilot(?![\w-])/g;

const COPILOT_ONLY_LINES = [
    /^\s*Follow Microsoft content policies\.?\s*$/gim
];

export function isCopilotPrompt(text: string): boolean {
    COPILOT_NAME.lastIndex = 0;
    return COPILOT_NAME.test(text);
}

/**
 * Rewrites a Copilot system prompt so the model identifies as Nova. Tool-usage,
 * workspace and formatting instructions are kept as they are.
 */
export function rewriteSystemPrompt(text: string): string {
    if (!isCopilotPrompt(text)) {
        return text;
    }

    let result = text.replace(COPILOT_NAME, 'Nova');
    for (const pattern of COPILOT_ONLY_LINES) {
        result = result.replace(pattern, '');
    }

    return `${NOVA_IDENTITY_PREAMBLE}\n\n${result.replace(/\n{3,}/g, '\n\n').trim()}`;
}

/**
 * Applies {@link rewriteSystemPrompt} to the system messages, or to the first user
 * message when the request has no system message (older VS Code versions send the
 * system prompt that way).
 */
export function rewriteIdentity(messages: ChatMessage[]): ChatMessage[] {
    const hasSystem = messages.some((message) => message.role === 'system');
    const firstUser = messages.findIndex((message) => message.role === 'user');

    return messages.map((message, index) => {
        const target = message.role === 'system' || (!hasSystem && index === firstUser);
        return target && typeof message.content === 'string'
            ? { ...message, content: rewriteSystemPrompt(message.content) }
            : message;
    });
}
