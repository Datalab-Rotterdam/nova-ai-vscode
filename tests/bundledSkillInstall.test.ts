import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_FILE, findAllSkills } from '../src/skills/SkillService';
import { BUNDLED_BY, installBundledSkills } from '../src/skills/bundledSkills';

let base: string;
let source: string;
let novaHome: string;

const writeSkill = (name: string, body: string) => {
    mkdirSync(join(source, name, 'scripts'), { recursive: true });
    writeFileSync(join(source, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Reads files.\n---\n${body}`);
    writeFileSync(join(source, name, 'scripts', 'read.py'), 'print(1)\n');
};

beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'nova-bundled-install-'));
    source = join(base, 'resources', 'skills');
    novaHome = join(base, '.nova-ai');
    mkdirSync(source, { recursive: true });
    writeSkill('sample-docs', 'v1');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('installBundledSkills', () => {
    it('installs a skill as a bundled one and leaves a current one alone', async () => {
        expect(await installBundledSkills(source, novaHome, '1.0.0')).toEqual(['sample-docs']);
        const folder = join(novaHome, 'skills', 'sample-docs');
        expect(readFileSync(join(folder, 'scripts', 'read.py'), 'utf8')).toBe('print(1)\n');
        const marker = JSON.parse(readFileSync(join(folder, BUNDLE_FILE), 'utf8'));
        expect(marker).toMatchObject({ bundledBy: BUNDLED_BY, version: '1.0.0' });
        expect(marker.hash).toMatch(/^[0-9a-f]{64}$/);

        const found = findAllSkills({ home: base, novaHome, workspaceRoots: [] }).find((skill) => skill.name === 'sample-docs');
        expect(found?.bundled?.bundledBy).toBe(BUNDLED_BY);

        expect(await installBundledSkills(source, novaHome, '1.0.0')).toEqual([]);
    });

    it('reinstalls when the shipped content changes or the installed copy was edited', async () => {
        await installBundledSkills(source, novaHome, '1.0.0');
        writeSkill('sample-docs', 'v2');
        expect(await installBundledSkills(source, novaHome, '1.1.0')).toEqual(['sample-docs']);
        const skill = join(novaHome, 'skills', 'sample-docs', 'SKILL.md');
        expect(readFileSync(skill, 'utf8')).toContain('v2');

        chmodSync(skill, 0o644);
        writeFileSync(skill, 'edited');
        expect(await installBundledSkills(source, novaHome, '1.1.0')).toEqual(['sample-docs']);
        expect(readFileSync(skill, 'utf8')).toContain('v2');
    });

    it('never touches a skill folder of the same name that is not ours', async () => {
        const own = join(novaHome, 'skills', 'sample-docs');
        mkdirSync(own, { recursive: true });
        writeFileSync(join(own, 'SKILL.md'), '---\nname: sample-docs\ndescription: Mine.\n---\nmine');
        expect(await installBundledSkills(source, novaHome, '1.0.0')).toEqual([]);
        expect(readFileSync(join(own, 'SKILL.md'), 'utf8')).toContain('mine');
        expect(existsSync(join(own, BUNDLE_FILE))).toBe(false);
    });

    it('is not fooled by Python caches the scripts leave behind', async () => {
        await installBundledSkills(source, novaHome, '1.0.0');
        const cache = join(novaHome, 'skills', 'sample-docs', 'scripts', '__pycache__');
        mkdirSync(cache, { recursive: true });
        writeFileSync(join(cache, 'read.cpython-314.pyc'), 'x');
        expect(await installBundledSkills(source, novaHome, '1.0.0')).toEqual([]);
    });

    it('removes a retired skill of ours but not one of the user', async () => {
        const old = join(novaHome, 'skills', 'nova-documents');
        mkdirSync(old, { recursive: true });
        writeFileSync(join(old, 'SKILL.md'), '---\nname: nova-documents\ndescription: Old.\n---\nold');
        writeFileSync(join(old, BUNDLE_FILE), JSON.stringify({ bundledBy: BUNDLED_BY, version: '1.0.0', hash: 'x' }));
        await installBundledSkills(source, novaHome, '1.1.0');
        expect(existsSync(old)).toBe(false);

        mkdirSync(old, { recursive: true });
        writeFileSync(join(old, 'SKILL.md'), '---\nname: nova-documents\ndescription: Mine.\n---\nmine');
        await installBundledSkills(source, novaHome, '1.1.0');
        expect(existsSync(join(old, 'SKILL.md'))).toBe(true);
    });

    it('ships a skill per document format, each with a reader, the environment helper and how-tos', async () => {
        const shipped = join(__dirname, '..', 'resources', 'skills');
        expect((await installBundledSkills(shipped, novaHome, '1.0.0')).sort()).toEqual(['nova-docx', 'nova-pdf', 'nova-pptx', 'nova-xlsx']);
        const scripts: Record<string, string[]> = {
            'nova-docx': ['docx_text.py', 'docx_review.py', 'docx_review_edit.py', 'docx_diff.py', 'office_meta.py', 'textdiff.py'],
            'nova-xlsx': ['xlsx_dump.py', 'xlsx_comments.py', 'xlsx_threads_edit.py', 'xlsx_diff.py', 'office_meta.py', 'textdiff.py'],
            'nova-pptx': ['pptx_text.py', 'pptx_comments.py', 'pptx_comments_edit.py', 'pptx_diff.py', 'office_meta.py', 'textdiff.py'],
            'nova-pdf': ['pdf_text.py', 'pdf_review.py', 'pdf_annots_edit.py', 'pdf_diff.py', 'textdiff.py']
        };
        const copy = (skill: string, file: string) => readFileSync(join(shipped, skill, 'scripts', file), 'utf8');
        for (const [name, files] of Object.entries(scripts)) {
            for (const file of ['SKILL.md', 'scripts/ensure_env.py', 'references/create.md', 'references/edit.md', 'references/review.md', ...files.map((script) => `scripts/${script}`)]) {
                expect(existsSync(join(novaHome, 'skills', name, file)), `${name}/${file}`).toBe(true);
            }
            // Skills are self-contained, so shared helpers are copied into each: the copies must not drift.
            for (const shared of ['ensure_env.py', 'textdiff.py', 'office_meta.py']) {
                if (existsSync(join(shipped, name, 'scripts', shared))) {
                    expect(copy(name, shared), `${name}/${shared}`).toBe(copy('nova-xlsx', shared));
                }
            }
        }
        const skills = findAllSkills({ home: base, novaHome, workspaceRoots: [] });
        expect(skills.find((entry) => entry.name === 'nova-pdf')?.description).toMatch(/PDF/);
        expect(skills.every((entry) => entry.description.length <= 200)).toBe(true);
    });
});
