import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
    createSkill,
    disabledSkills,
    enabledSkills,
    findAllSkills,
    moveSkill,
    setSkillEnabled,
    skillViews,
    type SkillPaths
} from '../src/skills/SkillService';
import { displayLocation } from '../src/skills/SkillsController';
import { buildSkillsPrompt, createLoadSkillTool, rankSkills } from '../src/skills/skillTools';

let base: string;
let paths: SkillPaths;

const skill = (dir: string, name: string, description: string, body = 'body') => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
};

beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'nova-skills-'));
    paths = {
        home: join(base, 'home'),
        novaHome: join(base, 'home', '.nova-ai'),
        projectSettings: join(base, 'home', '.nova-ai', 'projects', 'repo-1234abcd', 'settings.json'),
        workspaceRoots: [join(base, 'repo')]
    };
    mkdirSync(paths.workspaceRoots[0], { recursive: true });
});

afterEach(() => {
    rmSync(base, { recursive: true, force: true });
});

describe('skill folders (docs/NOVA_HOME.md, "Skills")', () => {
    it('finds skills in the shared and Nova folders; Nova and project folders win by name', () => {
        skill(join(paths.home, '.claude', 'skills'), 'review', 'Claude review.');
        skill(join(paths.novaHome, 'skills'), 'review', 'Nova review.');
        skill(join(paths.novaHome, 'skills'), 'release', 'Cut a release.');
        skill(join(paths.workspaceRoots[0], '.agents', 'skills'), 'deploy', 'Shared deploy.');
        skill(join(paths.workspaceRoots[0], '.nova-ai', 'skills'), 'deploy', 'Project deploy.');
        skill(join(paths.workspaceRoots[0], '.nova-ai', 'skills', 'nested'), 'lint', 'Nested lint.');

        expect(findAllSkills(paths).map((entry) => `${entry.scope}/${entry.folder}/${entry.name}`)).toEqual([
            'global/.claude/review',
            'global/nova/release',
            'global/nova/review',
            'project/.agents/deploy',
            'project/nova/deploy',
            'project/nova/lint'
        ]);
        expect(enabledSkills(paths).map((entry) => [entry.name, entry.description])).toEqual([
            ['deploy', 'Project deploy.'],
            ['lint', 'Nested lint.'],
            ['release', 'Cut a release.'],
            ['review', 'Nova review.']
        ]);
        const replaced = skillViews(paths).find((view) => view.folder === '.claude')!;
        expect(replaced).toMatchObject({ enabled: false, replacedBy: join(paths.novaHome, 'skills', 'review', 'SKILL.md') });
    });

    it('switches skills off by name, globally or for this project, keeping other settings', async () => {
        skill(join(paths.novaHome, 'skills'), 'review', 'Review.');
        skill(join(paths.workspaceRoots[0], '.nova-ai', 'skills'), 'deploy', 'Deploy.');
        mkdirSync(paths.novaHome, { recursive: true });
        writeFileSync(join(paths.novaHome, 'settings.json'), JSON.stringify({ permissions: { deny: ['read_file(.env)'] } }));

        await setSkillEnabled(paths, 'global', 'review', false);
        await setSkillEnabled(paths, 'project', 'deploy', false);
        expect(enabledSkills(paths)).toEqual([]);
        expect(JSON.parse(readFileSync(join(paths.novaHome, 'settings.json'), 'utf8'))).toEqual({
            permissions: { deny: ['read_file(.env)'] },
            skills: { disabled: ['review'] }
        });
        expect(skillViews(paths).map((view) => [view.name, view.offGlobally, view.offInProject])).toEqual([
            ['deploy', false, true],
            ['review', true, false]
        ]);

        await setSkillEnabled(paths, 'project', 'deploy', true);
        expect(disabledSkills(paths).project.size).toBe(0);
        expect(enabledSkills(paths).map((entry) => entry.name)).toEqual(['deploy']);
    });

    it('refuses to rewrite a settings file that is not valid JSON', async () => {
        mkdirSync(paths.novaHome, { recursive: true });
        writeFileSync(join(paths.novaHome, 'settings.json'), '{ broken');
        await expect(setSkillEnabled(paths, 'global', 'review', false)).rejects.toThrow(/not valid JSON/);
        expect(readFileSync(join(paths.novaHome, 'settings.json'), 'utf8')).toBe('{ broken');
    });

    it('creates a skill from the template in Nova\'s folder of the scope', async () => {
        const file = await createSkill(paths, 'project', 'release-notes', 'Write release notes: "short"');
        expect(file).toBe(join(paths.workspaceRoots[0], '.nova-ai', 'skills', 'release-notes', 'SKILL.md'));
        expect(enabledSkills(paths)).toMatchObject([{ name: 'release-notes', description: 'Write release notes: "short"', scope: 'project' }]);
        await expect(createSkill(paths, 'project', 'release-notes', '')).rejects.toThrow(/already exists/);
        await expect(createSkill(paths, 'global', 'Bad Name', '')).rejects.toThrow(/lower-case/);
        expect(await createSkill(paths, 'global', 'release-notes', '')).toBe(join(paths.novaHome, 'skills', 'release-notes', 'SKILL.md'));
    });

    it('moves a skill with its files between global and project', async () => {
        skill(join(paths.home, '.claude', 'skills'), 'review', 'Review.');
        writeFileSync(join(paths.home, '.claude', 'skills', 'review', 'checklist.md'), 'check');
        const source = findAllSkills(paths)[0];

        const moved = await moveSkill(paths, source, 'project');
        expect(moved).toBe(join(paths.workspaceRoots[0], '.nova-ai', 'skills', 'review', 'SKILL.md'));
        expect(existsSync(join(paths.home, '.claude', 'skills', 'review'))).toBe(false);
        expect(readFileSync(join(paths.workspaceRoots[0], '.nova-ai', 'skills', 'review', 'checklist.md'), 'utf8')).toBe('check');

        skill(join(paths.novaHome, 'skills'), 'review', 'Other review.');
        await expect(moveSkill(paths, findAllSkills(paths).find((entry) => entry.scope === 'project')!, 'global')).rejects.toThrow(/already exists/);
    });

    it('shows locations relative to the workspace or the home folder', () => {
        expect(displayLocation(join(paths.workspaceRoots[0], '.nova-ai', 'skills', 'x'), paths, paths.home)).toBe('.nova-ai/skills/x');
        expect(displayLocation(join(paths.novaHome, 'skills'), paths, paths.home)).toBe('~/.nova-ai/skills');
        expect(displayLocation('/elsewhere/skills', paths, paths.home)).toBe('/elsewhere/skills');
    });
});

describe('skills in the chat', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
        name: `skill-${String(index).padStart(2, '0')}`,
        description: `Does task ${index} ${'with a long explanation '.repeat(10)}`
    }));

    it('keeps the skill list within its budget, describing the skills that match the message', () => {
        const prompt = buildSkillsPrompt([...many, { name: 'deploy-kubernetes', description: 'Roll out to the cluster.' }], 'deploy this to kubernetes')!;
        expect(prompt.length).toBeLessThan(6_000);
        expect(prompt).toMatch(/^- deploy-kubernetes: Roll out to the cluster\.$/m);
        expect(prompt).toMatch(/More skills \(load by name when one fits\): .*skill-\d\d/);
        expect(buildSkillsPrompt(many.slice(0, 2), 'x')!.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
        expect(buildSkillsPrompt([])).toBeUndefined();
        expect(rankSkills([{ name: 'b', description: 'x' }, { name: 'release', description: 'y' }], 'release it').map((entry) => entry.name)).toEqual(['release', 'b']);
    });

    it('load_skill reads a skill and its files, never outside its folder', async () => {
        skill(join(paths.novaHome, 'skills'), 'review', 'Review.', '# Steps');
        writeFileSync(join(paths.novaHome, 'skills', 'review', 'checklist.md'), 'check this');
        const tool = createLoadSkillTool(enabledSkills(paths));
        const context = { token: new vscode.CancellationTokenSource().token };
        const run = (input: Record<string, unknown>) => tool.invoke(input, context, { title: '' });

        expect(await run({ name: 'review' })).toMatch(/Resource: SKILL\.md\n\n---\nname: review[\s\S]*# Steps$/);
        expect(await run({ name: 'review', resource: 'checklist.md' })).toMatch(/check this$/);
        await expect(run({ name: 'review', resource: '../../settings.json' })).rejects.toThrow(/inside/);
        await expect(run({ name: 'missing' })).rejects.toThrow(/Unknown skill/);
        expect(tool.readOnly).toBe(true);
    });
});
