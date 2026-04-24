import type { NovaLanguageModelInfo, NovaSessionSnapshot } from '../types';

export interface SidebarRenderState {
  snapshot: NovaSessionSnapshot;
  preferredModel?: NovaLanguageModelInfo;
  logoUri?: string;
  backgroundVideoUri?: string;
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

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; media-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nova AI</title>
    ${styleTag}
  </head>
  <body>
    <div id="app"></div>
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
