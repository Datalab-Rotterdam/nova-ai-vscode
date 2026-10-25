import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from '../src/permissions/PermissionService';
import type { ToolsPageData } from '../src/tools/protocol';
import { ToolsController } from '../src/tools/ToolsController';

describe('tools page', () => {
  let dir: string;
  let permissions: PermissionService;
  let pages: ToolsPageData[];
  let controller: ToolsController;
  const catalog = () => [
    { name: 'read_file', description: 'Reads a file.\nMore.', readOnly: true, category: 'Built-in Tools', group: 'Files and Search', groupDescription: '' },
    { name: 'open_browser_page', description: 'Opens a page.', readOnly: false, category: 'VS Code Tools', group: 'Integrated Browser', groupDescription: '' },
    { name: 'read_page', description: 'Reads a page.', readOnly: true, category: 'VS Code Tools', group: 'Integrated Browser', groupDescription: '' }
  ];
  const state = () => pages[pages.length - 1];
  const rows = () => state().groups.flatMap((group) => group.tools);

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nova-tools-'));
    permissions = new PermissionService(path.join(dir, 'settings.json'), () => undefined, () => true, () => path.join(dir, 'project.json'));
    pages = [];
    controller = new ToolsController(catalog, permissions, () => true, (message) => pages.push(message.data));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists tools by group, built-in first', async () => {
    await controller.handle({ command: 'tools/ready' });
    expect(state().groups.map((group) => `${group.category} / ${group.title}`)).toEqual(['Built-in Tools / Files and Search', 'VS Code Tools / Integrated Browser']);
    expect(rows().every((row) => row.enabled)).toBe(true);
  });

  it('switches tools off for the user and the chat no longer gets them', async () => {
    await controller.handle({ command: 'tools/set', names: ['open_browser_page', 'read_page'], enabled: false });
    expect(rows().filter((row) => !row.enabled).map((row) => row.name)).toEqual(['open_browser_page', 'read_page']);
    expect([...await permissions.disabledTools()].sort()).toEqual(['open_browser_page', 'read_page']);
    await controller.handle({ command: 'tools/set', names: ['read_page'], enabled: true });
    expect([...await permissions.disabledTools()]).toEqual(['open_browser_page']);
  });

  it('lets a project switch on what the user switched off, and off what the user left on', async () => {
    await permissions.setToolsEnabled(['read_page'], false, 'user');
    await permissions.setToolsEnabled(['read_page'], true, 'project');
    await permissions.setToolsEnabled(['read_file'], false, 'project');
    expect([...await permissions.disabledTools()]).toEqual(['read_file']);

    await controller.handle({ command: 'tools/scope', scope: 'project' });
    expect(state().scope).toBe('project');
    expect(rows().find((row) => row.name === 'read_file')?.enabled).toBe(false);
    expect(rows().find((row) => row.name === 'read_page')?.enabled).toBe(true);

    // The project can switch it off again.
    await permissions.setToolsEnabled(['read_page'], false, 'project');
    expect((await permissions.disabledTools()).has('read_page')).toBe(true);
  });

  it('stays on the user scope without a project', async () => {
    const lonely = new ToolsController(catalog, permissions, () => false, (message) => pages.push(message.data));
    await lonely.handle({ command: 'tools/scope', scope: 'project' });
    expect(state().scope).toBe('user');
  });
});
