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

export function isEmptyResponse(error: unknown): boolean {
  return error instanceof Error && (error as Error & {isEmptyResponse?: boolean}).isEmptyResponse === true;
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

const CONTEXT_OVERFLOW = /context[ _-]?length|context window|maximum context|too many tokens|prompt is too long|input is too long|exceeds? (?:the )?(?:model'?s? )?(?:maximum|max)|max_model_len/i;

/** Whether the request failed because the prompt does not fit the model's context window. */
export function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = isNovaErrorLike(error) ? error.status : undefined;
  const text = isNovaErrorLike(error) ? `${error.message} ${error.code ?? ''} ${error.type ?? ''}` : error.message;
  return (status === undefined || status === 400 || status === 413) && CONTEXT_OVERFLOW.test(text);
}

/** Extracts the real context window from overflow errors such as "maximum context length is 8192 tokens". */
export function parseContextLimit(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const match = /(?:maximum context length|context length|context window|max_model_len)\D{0,40}?(\d{3,8})/i.exec(error.message);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
