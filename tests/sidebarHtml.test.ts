import { describe, expect, it } from 'vitest';
import { renderSidebarDocument } from '../src/views/sidebarHtml';

describe('sidebarHtml', () => {
  it('renders signed-out onboarding state bootstrap', () => {
    const html = renderSidebarDocument({
      snapshot: {
        hasApiKey: false,
        connectionHealth: 'signedOut',
        toolCallingSupport: 'unknown'
      }
    }, 'nonce', 'csp-source', 'main.js', 'main.css');

    expect(html).toContain('id="app"');
    expect(html).toContain('"hasApiKey":false');
    expect(html).toContain('src="main.js"');
    expect(html).toContain('href="main.css"');
  });

  it('renders signed-in account bootstrap state', () => {
    const html = renderSidebarDocument({
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
    }, 'nonce', 'csp-source', 'main.js');

    expect(html).toContain('"hasApiKey":true');
    expect(html).toContain('"modelCount":3');
    expect(html).toContain('"selectedModelId":"nova-pro"');
  });
});
