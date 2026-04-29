import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Resource } from '../src/views/svelte';
import { renderWebviewDocument } from '../src/views';

const generatedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Nova AI</title>
  <!--nova:svelte-head-->
  <script type="module" crossorigin src="/assets/index.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index.css">
  <link rel="stylesheet" crossorigin href="/assets/theme.css">
</head>
<body>
  <div id="app"></div>
  <!--nova:svelte-body-->
</body>
</html>`;

describe('sidebar webview document', () => {
  it('preserves Svelte-style placeholders as generated HTML markers', () => {
    const html = readFileSync(join(process.cwd(), 'out', 'webview', 'webview', 'index.html'), 'utf8');

    expect(html).toContain('<!--nova:svelte-head-->');
    expect(html).toContain('<!--nova:svelte-body-->');
    expect(html).not.toContain('%svelte.head%');
    expect(html).not.toContain('%svelte.body%');
  });

  it('injects CSP, bootstrap state, nonce and rewritten asset URIs', () => {
    const html = renderWebviewDocument({
      generatedHtml,
      nonce: 'nonce',
      cspSource: 'csp-source',
      resources: [
        new Resource('assets/index.js'),
        new Resource('assets/index.css'),
        new Resource('assets/theme.css')
      ],
      toWebviewUri: (resource) => `vscode-resource://${resource}`,
      state: {
        snapshot: {
          hasApiKey: false,
          connectionHealth: 'signedOut',
          toolCallingSupport: 'unknown'
        },
        logoUri: 'vscode-resource://logo.svg'
      }
    });

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'nonce-nonce'");
    expect(html).toContain('nonce="nonce" type="module"');
    expect(html).toContain('src="vscode-resource://assets/index.js"');
    expect(html).toContain('href="vscode-resource://assets/index.css"');
    expect(html).toContain('href="vscode-resource://assets/theme.css"');
    expect(html).toContain('window.__NOVA_SIDEBAR_STATE__');
    expect(html).toContain('"hasApiKey":false');
    expect(html).toContain('<div id="app"><div class="nova-loader"');
    expect(html).not.toContain('<!--nova:svelte-head-->');
    expect(html).not.toContain('<!--nova:svelte-body-->');
  });

  it('falls back to head and body tags when placeholder comments are absent', () => {
    const html = renderWebviewDocument({
      generatedHtml: '<html><head><script src="/assets/app.js"></script></head><body><div id="app"></div></body></html>',
      nonce: 'fallback',
      cspSource: 'csp-source',
      resources: [new Resource('assets/app.js')],
      toWebviewUri: (resource) => `vscode-resource://${resource}`,
      state: {
        snapshot: {
          hasApiKey: true,
          connectionHealth: 'connected',
          toolCallingSupport: 'supported',
          selectedModelId: 'nova-pro',
          accountSummary: {
            providerNames: ['Nova Runtime'],
            modelCount: 3,
            validatedAt: '2026-04-24T00:00:00.000Z',
            baseUrl: 'https://api.example.test/v1'
          }
        }
      }
    });

    expect(html).toContain('"hasApiKey":true');
    expect(html).toContain('"modelCount":3');
    expect(html).toContain('"selectedModelId":"nova-pro"');
    expect(html).toContain('nonce="fallback" src="vscode-resource://assets/app.js"');
  });
});
