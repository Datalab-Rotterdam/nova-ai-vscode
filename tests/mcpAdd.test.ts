import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseServer } from '../src/mcp/config';
import { addServerToFile, defaultName, parseEnv, removeServerFromFile, serverEntry, splitCommand } from '../src/mcp/addServer';

describe('adding an MCP server', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'nova-mcp-add-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('splits a command line, keeping quoted words together', () => {
    expect(splitCommand('npx -y "my pkg" \'a b\' c')).toEqual(['npx', '-y', 'my pkg', 'a b', 'c']);
  });

  it('parses environment variables and rejects a pair without a key', () => {
    expect(parseEnv('A=1, B=${B}')).toEqual({ A: '1', B: '${B}' });
    expect(parseEnv('')).toEqual({});
    expect(parseEnv('=oops')).toBeUndefined();
  });

  it('builds entries Nova reads back as valid servers', () => {
    const cases = [
      serverEntry({ kind: 'stdio', target: 'npx -y @modelcontextprotocol/server-filesystem .', env: { A: '1' } }),
      serverEntry({ kind: 'http', target: 'https://mcp.example.com/mcp', authorization: 'Bearer ${T}' }),
      serverEntry({ kind: 'npm', target: '@scope/server-memory', args: '--ro' }),
      serverEntry({ kind: 'pip', target: 'mcp-server-git' }),
      serverEntry({ kind: 'docker', target: 'mcp/fetch', env: { KEY: 'x' } })
    ];
    for (const entry of cases) {
      expect(typeof parseServer('s', 'user', entry)).toBe('object');
    }
    expect(cases[2]).toEqual({ command: 'npx', args: ['-y', '@scope/server-memory', '--ro'] });
    expect(cases[4]).toEqual({ command: 'docker', args: ['run', '-i', '--rm', '-e', 'KEY', 'mcp/fetch'], env: { KEY: 'x' } });
    expect(cases[1]).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${T}' } });
  });

  it('suggests a name', () => {
    expect(defaultName({ kind: 'npm', target: '@modelcontextprotocol/server-memory' })).toBe('memory');
    expect(defaultName({ kind: 'pip', target: 'mcp-server-git' })).toBe('git');
    expect(defaultName({ kind: 'http', target: 'https://mcp.example.com/mcp' })).toBe('example');
    expect(defaultName({ kind: 'docker', target: 'mcp/fetch:latest' })).toBe('fetch');
    expect(defaultName({ kind: 'stdio', target: 'npx -y @modelcontextprotocol/server-filesystem .' })).toBe('filesystem');
  });

  it('adds to a new or an existing file and keeps its other content', async () => {
    const file = path.join(dir, 'sub', 'mcp.json');
    await addServerToFile(file, 'a', { command: 'a' }, false);
    writeFileSync(file, JSON.stringify({ other: 1, mcpServers: { a: { command: 'a' } } }));
    await addServerToFile(file, 'b', { command: 'b' }, false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1, mcpServers: { a: { command: 'a' }, b: { command: 'b' } } });
    writeFileSync(file, '{ nope');
    await expect(addServerToFile(file, 'c', { command: 'c' }, false)).rejects.toThrow(/not valid JSON/);
  });

  it('removes a server and keeps the rest of the file', async () => {
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ other: 1, mcpServers: { a: { command: 'a' }, b: { command: 'b' } } }));
    expect(await removeServerFromFile(file, 'a', false)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1, mcpServers: { b: { command: 'b' } } });
    expect(await removeServerFromFile(file, 'a', false)).toBe(false);
    expect(await removeServerFromFile(path.join(dir, 'missing.json'), 'a', false)).toBe(false);
    writeFileSync(file, '{ nope');
    await expect(removeServerFromFile(file, 'b', false)).rejects.toThrow(/not valid JSON/);
  });
});
