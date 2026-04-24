import * as vscode from 'vscode';
import { DEFAULT_BASE_URL } from './constants';

export function getBaseUrl(): string {
  return vscode.workspace.getConfiguration('nova').get<string>('baseUrl', DEFAULT_BASE_URL);
}

export function getDefaultModelOverride(): string | undefined {
  const value = vscode.workspace.getConfiguration('nova').get<string>('defaultModel', '').trim();
  return value || undefined;
}

export function isDiagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration('nova').get<boolean>('enableDiagnostics', false);
}

