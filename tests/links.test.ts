import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { classifyLink, confirmAndOpenExternal, misleadingHost } from '../src/panel/links';

describe('classifyLink', () => {
  it('treats web and mail links as external', () => {
    expect(classifyLink('https://example.com/docs?q=1')).toMatchObject({ kind: 'external', url: new URL('https://example.com/docs?q=1') });
    expect(classifyLink('http://example.com')).toMatchObject({ kind: 'external' });
    expect(classifyLink('mailto:someone@example.com')).toMatchObject({ kind: 'external' });
  });

  it('refuses schemes that could run commands or leave the workspace', () => {
    for (const href of ['command:workbench.action.terminal.new', 'vscode://settings', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', '//evil.example', '#top', '']) {
      expect(classifyLink(href).kind, href).toBe('blocked');
    }
  });

  it('opens relative paths as workspace files, with an optional line', () => {
    expect(classifyLink('src/panel/links.ts')).toEqual({ kind: 'file', path: 'src/panel/links.ts', line: undefined });
    expect(classifyLink('./src/my%20file.ts#L12')).toEqual({ kind: 'file', path: 'src/my file.ts', line: 12 });
    expect(classifyLink('C:\\repo\\file.ts')).toMatchObject({ kind: 'file' });
  });
});

describe('misleadingHost', () => {
  it('flags link text that names a different host than the link', () => {
    expect(misleadingHost('github.com/login', new URL('https://github.evil.example/login'))).toBe('github.com');
    expect(misleadingHost('https://www.example.com', new URL('https://example.com/'))).toBeUndefined();
    expect(misleadingHost('the docs', new URL('https://example.com/'))).toBeUndefined();
  });
});

describe('confirmAndOpenExternal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the full address and opens it only when confirmed', async () => {
    const ask = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce(undefined as never);
    const open = vi.spyOn(vscode.env, 'openExternal');
    expect(await confirmAndOpenExternal(new URL('https://example.com/a?b=c'), 'docs')).toBe(false);
    expect(ask).toHaveBeenCalledWith('Open example.com in your browser?', { modal: true, detail: 'https://example.com/a?b=c' }, 'Open in Browser', 'Copy Link');
    expect(open).not.toHaveBeenCalled();

    ask.mockResolvedValueOnce('Open in Browser' as never);
    expect(await confirmAndOpenExternal(new URL('https://example.com/a?b=c'), 'docs')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('warns about misleading link text and insecure links, and can copy instead of opening', async () => {
    const ask = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValueOnce('Copy Link' as never);
    const copy = vi.spyOn(vscode.env.clipboard, 'writeText');
    const open = vi.spyOn(vscode.env, 'openExternal');
    await confirmAndOpenExternal(new URL('http://login.evil.example/'), 'github.com');
    const detail = (ask.mock.calls[0][1] as { detail: string }).detail;
    expect(detail).toContain('the link text says github.com, but the link goes to login.evil.example');
    expect(detail).toContain('does not use a secure connection');
    expect(copy).toHaveBeenCalledWith('http://login.evil.example/');
    expect(open).not.toHaveBeenCalled();
  });
});
