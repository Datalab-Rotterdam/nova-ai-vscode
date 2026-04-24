import * as vscode from 'vscode';

export function estimateTokenCount(input: string | vscode.LanguageModelChatRequestMessage): number {
  const text = typeof input === 'string' ? input : flattenMessage(input);
  return Math.max(1, Math.ceil(text.length / 4));
}

export function flattenMessage(message: vscode.LanguageModelChatRequestMessage): string {
  const chunks = message.content.map((part) => {
    if (part instanceof vscode.LanguageModelTextPart) {
      return part.value;
    }

    if (part instanceof vscode.LanguageModelToolCallPart) {
      return `${part.name} ${JSON.stringify(part.input)}`;
    }

    if (part instanceof vscode.LanguageModelToolResultPart) {
      return part.content.map(stringifyUnknown).join('\n');
    }

    if (part instanceof vscode.LanguageModelDataPart) {
      return new TextDecoder().decode(part.data);
    }

    return stringifyUnknown(part);
  });

  return chunks.join('\n');
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

