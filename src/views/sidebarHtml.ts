import type { NovaLanguageModelInfo, NovaSessionSnapshot } from '../types';

export interface SidebarRenderState {
  snapshot: NovaSessionSnapshot;
  preferredModel?: NovaLanguageModelInfo;
  logoUri?: string;
}

export function renderSidebarDocument(
  state: SidebarRenderState,
  nonce: string,
  cspSource: string,
  scriptUri: string,
  styleUri?: string
): string {
  const styleTag = styleUri ? `<link rel="stylesheet" href="${styleUri}">` : '';
  const bootstrap = escapeScript(JSON.stringify(state));
  const loaderLogo = state.logoUri
    ? `<img class="nova-loader__logo" src="${escapeAttribute(state.logoUri)}" alt="Nova AI" />`
    : '<div class="nova-loader__mark" aria-hidden="true"></div>';

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; media-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nova AI</title>
    <style>
      .nova-loader {
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground);
      }

      .nova-loader__logo,
      .nova-loader__mark {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        animation: nova-loader-pulse 1.4s ease-in-out infinite;
      }

      .nova-loader__logo {
        object-fit: contain;
      }

      .nova-loader__mark {
        border: 1px solid var(--vscode-sideBar-border, var(--vscode-descriptionForeground));
        background: var(--vscode-input-background);
      }

      @keyframes nova-loader-pulse {
        0%, 100% { opacity: 0.42; transform: scale(0.96); }
        50% { opacity: 1; transform: scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .nova-loader__logo,
        .nova-loader__mark {
          animation: none;
        }
      }
    </style>
    ${styleTag}
  </head>
  <body>
    <div id="app"><div class="nova-loader" aria-label="Loading Nova AI">${loaderLogo}</div></div>
    <script nonce="${nonce}">
      window.__NOVA_SIDEBAR_STATE__ = ${bootstrap};
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
  </html>`;
}

function escapeScript(value: string): string {
  return value
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
