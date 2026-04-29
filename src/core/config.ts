import * as vscode from 'vscode';

export function isDiagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration('nova').get<boolean>('enableDiagnostics', false);
}

export function shouldParseModelCapabilities(): boolean {
  return vscode.workspace.getConfiguration('nova').get<boolean>('developer.parseModelCapabilities', true);
}
