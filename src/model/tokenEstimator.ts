import * as vscode from 'vscode';
import { isThinkingPart } from '../core/apiSupport';
import { NOVA_USAGE_MIME_TYPE } from '../core/constants';
import { toolResultText } from './messages';

/** Rough cost of one image in the prompt; the bytes themselves are not text. */
const IMAGE_TOKENS = 1_000;

type MessageLike = Pick<vscode.LanguageModelChatRequestMessage, 'content'>;

export function estimateTokenCount(input: string | MessageLike): number {
  if (typeof input === 'string') {
    return estimateTextTokens(input);
  }

  let tokens = 4; // role and message framing
  for (const part of input.content) {
    if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
      tokens += IMAGE_TOKENS;
    } else {
      tokens += estimateTextTokens(partText(part));
    }
  }
  return tokens;
}

/** Conservative estimate: ~3 UTF-8 bytes per token. */
export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 3));
}

export function flattenMessage(message: MessageLike): string {
  return message.content.map(partText).filter(Boolean).join('\n');
}

function partText(part: unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return `${part.name} ${JSON.stringify(part.input)}`;
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    return toolResultText(part.content);
  }
  if (part instanceof vscode.LanguageModelDataPart) {
    const mimeType = part.mimeType.toLowerCase();
    return mimeType !== NOVA_USAGE_MIME_TYPE && (mimeType.startsWith('text/') || mimeType === 'application/json')
      ? new TextDecoder().decode(part.data)
      : '';
  }
  if (isThinkingPart(part)) {
    return '';
  }
  return typeof part === 'string' ? part : '';
}
