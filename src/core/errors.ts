import * as vscode from 'vscode';

export function mapNovaError(error: unknown): Error {
  if (isNovaErrorLike(error)) {
    const message = error.requestId ? `${error.message} (request ${error.requestId})` : error.message;

    if (error.status === 401 || error.status === 403) {
      return vscode.LanguageModelError.NoPermissions(message);
    }

    if (error.status === 404) {
      return vscode.LanguageModelError.NotFound(message);
    }

    if (error.status === 429) {
      return vscode.LanguageModelError.Blocked(message);
    }

    return new Error(message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error('Nova AI request failed.');
}

export function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Nova AI request failed.';
}

export function isToolCallingRejected(error: unknown): boolean {
  if (!isNovaErrorLike(error)) {
    return false;
  }

  const message = `${error.message} ${error.code ?? ''} ${error.type ?? ''}`.toLowerCase();
  return error.status === 400 && (
    message.includes('tool') ||
    message.includes('function') ||
    message.includes('tool_choice')
  );
}

interface NovaErrorLike extends Error {
  status: number;
  requestId: string | null;
  type: string | null;
  code: string | null;
}

function isNovaErrorLike(error: unknown): error is NovaErrorLike {
  return error instanceof Error
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
    && 'requestId' in error
    && 'type' in error
    && 'code' in error;
}
