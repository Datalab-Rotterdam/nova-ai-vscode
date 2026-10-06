import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createFileTool, editFileTool } from '../src/agent/tools/editTools';
import { ToolInputError } from '../src/agent/tools/types';
import { BUNDLE_FILE, bundledSkillOf, findAllSkills, moveSkill, type SkillPaths } from '../src/skills/SkillService';

type MutableWorkspace = { workspaceFolders?: Array<{ name: string; uri: vscode.Uri; index: number }> };
const token = new vscode.CancellationTokenSource().token;

let base: string;
let paths: SkillPaths;

const bundledSkill = (dir: string, name: string) => {
    mkdirSync(join(dir, name, 'references'), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Bundled.\n---\nbody`);
    writeFileSync(join(dir, name, 'references', 'tools.md'), 'tools');
    writeFileSync(join(dir, name, BUNDLE_FILE), JSON.stringify({ bundledBy: 'Nova AI Browser', version: '0.1.0', hash: 'x' }));
};

beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'nova-bundled-'));
    paths = {
        home: join(base, 'home'),
        novaHome: join(base, 'home', '.nova-ai'),
        workspaceRoots: [join(base, 'repo')]
    };
    mkdirSync(paths.workspaceRoots[0], { recursive: true });
    bundledSkill(join(paths.novaHome, 'skills'), 'nova-browser');
    bundledSkill(join(paths.workspaceRoots[0], '.nova-ai', 'skills'), 'team-browser');
});

afterEach(() => {
    (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = undefined;
    rmSync(base, { recursive: true, force: true });
});

describe('bundled skills (docs/NOVA_HOME.md, "Bundled skills")', () => {
    it('are recognized by their marker', () => {
        const found = findAllSkills(paths).find((skill) => skill.name === 'nova-browser');
        expect(found?.bundled).toEqual({ bundledBy: 'Nova AI Browser', version: '0.1.0' });
        expect(bundledSkillOf(join(paths.novaHome, 'skills', 'nova-browser', 'references', 'tools.md'))?.bundle.bundledBy).toBe('Nova AI Browser');
        expect(bundledSkillOf(join(paths.workspaceRoots[0], 'src', 'app.ts'))).toBeUndefined();
    });

    it('cannot be moved', async () => {
        const skill = findAllSkills(paths).find((entry) => entry.name === 'nova-browser')!;
        await expect(moveSkill(paths, skill, 'project')).rejects.toThrow(/bundled with Nova AI Browser.*only switched off/);
    });

    it('cannot be changed by the agent\'s edit tools', async () => {
        (vscode.workspace as unknown as MutableWorkspace).workspaceFolders = [
            { name: 'repo', uri: vscode.Uri.file(paths.workspaceRoots[0]), index: 0 }
        ];
        await expect(editFileTool.prepare({ path: '.nova-ai/skills/team-browser/SKILL.md', old_string: 'body', new_string: 'changed' } as never, { token }))
            .rejects.toBeInstanceOf(ToolInputError);
        await expect(createFileTool.prepare({ path: '.nova-ai/skills/team-browser/extra.md', content: 'x' } as never, { token }))
            .rejects.toThrow(/only switched off/);
        // Other files stay editable.
        await expect(createFileTool.prepare({ path: 'notes.md', content: 'x' } as never, { token })).resolves.toBeDefined();
    });
});
