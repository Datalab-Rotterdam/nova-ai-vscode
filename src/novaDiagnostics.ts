import * as vscode from 'vscode';
import { isDiagnosticsEnabled } from './config';

export class NovaDiagnostics implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('Nova AI');

  public trace(message: string, data?: unknown): void {
    if (!isDiagnosticsEnabled()) {
      return;
    }

    this.append('trace', message, data);
  }

  public info(message: string, data?: unknown): void {
    this.append('info', message, data);
  }

  public error(message: string, error?: unknown): void {
    this.append('error', message, error);
  }

  public show(preserveFocus = false): void {
    this.channel.show(preserveFocus);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private append(level: 'trace' | 'info' | 'error', message: string, data?: unknown): void {
    const suffix = data === undefined ? '' : ` ${safeSerialize(data)}`;
    this.channel.appendLine(`[${new Date().toISOString()}] [${level}] ${message}${suffix}`);
  }
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

