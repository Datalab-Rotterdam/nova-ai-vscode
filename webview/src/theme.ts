import type { ThemeMode } from './types';

export function detectThemeMode(target: Element = document.body): ThemeMode {
  const classList = target.classList;

  if (classList.contains('vscode-high-contrast') || classList.contains('vscode-high-contrast-light')) {
    return 'high-contrast';
  }

  if (classList.contains('vscode-light')) {
    return 'light';
  }

  return 'dark';
}

