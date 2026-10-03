import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { htmlToText } from '../src/agent/tools/htmlToText';
import { fetchUrl, parseUrl } from '../src/agent/tools/webTools';

const token = vscode.CancellationToken.None as vscode.CancellationToken;

describe('htmlToText', () => {
  it('keeps main content as markdown-like text and drops scripts and chrome', () => {
    const { title, text } = htmlToText(`<!doctype html><html><head><title>Docs &amp; Guides</title><style>p{}</style></head>
      <body><nav>Menu</nav><main><h1>Install</h1><p>Run <code>npm i</code> first.</p>
      <ul><li>Fast</li><li>Small</li></ul><pre>const a = 1 &lt; 2;</pre>
      <a href="/next">Next page</a>${'<p>filler text</p>'.repeat(40)}</main><script>alert(1)</script></body></html>`, 'https://example.com/docs/');

    expect(title).toBe('Docs & Guides');
    expect(text).toContain('# Install');
    expect(text).toContain('Run `npm i` first.');
    expect(text).toContain('- Fast');
    expect(text).toContain('const a = 1 < 2;');
    expect(text).toContain('[Next page](https://example.com/next)');
    expect(text).not.toContain('Menu');
    expect(text).not.toContain('alert');
  });
});

describe('fetch_url', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/page') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<html><head><title>Hello</title></head><body><p>${'word '.repeat(6_000)}</p></body></html>`);
      } else if (request.url === '/data') {
        response.setHeader('Content-Type', 'application/json');
        response.end('{"ok":true}');
      } else if (request.url === '/image') {
        response.setHeader('Content-Type', 'image/png');
        response.end(Buffer.from([1, 2, 3]));
      } else {
        response.statusCode = 404;
        response.end('not here');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('returns readable page text and lets the model page through long content', async () => {
    const first = await fetchUrl(new URL(`${base}/page`), 0, token);
    expect(first).toContain('Title: Hello');
    expect(first).toMatch(/startChar=20000/);

    const second = await fetchUrl(new URL(`${base}/page`), 20_000, token);
    expect(second).toContain('word');
    expect(second).not.toMatch(/startChar=/);
  });

  it('returns JSON bodies as they are and reports HTTP errors', async () => {
    expect(await fetchUrl(new URL(`${base}/data`), 0, token)).toContain('{"ok":true}');
    expect(await fetchUrl(new URL(`${base}/missing`), 0, token)).toMatch(/^HTTP 404/);
  });

  it('refuses binary content', async () => {
    expect(await fetchUrl(new URL(`${base}/image`), 0, token)).toContain('Cannot read image/png');
  });

  it('only accepts plain http(s) URLs', () => {
    expect(parseUrl('https://example.com/a').host).toBe('example.com');
    expect(() => parseUrl('file:///etc/passwd')).toThrow(/Only http and https/);
    expect(() => parseUrl('https://user:secret@example.com')).toThrow(/credentials/);
    expect(() => parseUrl('example.com')).toThrow(/not a valid absolute URL/);
  });
});
