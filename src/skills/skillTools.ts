import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type NovaTool, ToolInputError } from '../agent/tools/types';
import type { Skill } from './SkillService';

/*
 * The skill list in the system prompt and the load_skill tool, with the same budget as
 * nova-ai-cli (docs/NOVA_HOME.md, "Skills"): only names and short descriptions in every
 * request; a skill's instructions are read when the model needs them.
 */

/** Room the list may take in every request (characters, about 1k tokens). */
const CATALOG_CHARS = 4_000;
/** Room for the names of skills that did not fit with their description. */
const NAMES_CHARS = 1_000;
const DESCRIPTION_CHARS = 160;
/** Most of one skill file returned by load_skill. */
const MAX_SKILL_CHARS = 24_000;

type SkillSummary = Pick<Skill, 'name' | 'description'>;

/**
 * The skill section of the system prompt; undefined without skills. With more skills than
 * fit, those matching `query` (the user's message) keep their description, others are
 * listed by name, and the rest are counted.
 */
export function buildSkillsPrompt(skills: readonly SkillSummary[], query = ''): string | undefined {
    if (!skills.length) {
        return undefined;
    }
    const entry = (skill: SkillSummary) => `- ${skill.name}: ${clip(oneLine(skill.description), DESCRIPTION_CHARS)}`;
    const all = skills.map(entry);
    const lines: string[] = [];
    const names: string[] = [];
    let more = 0;
    if (all.join('\n').length <= CATALOG_CHARS) {
        lines.push(...all);
    } else {
        let used = 0;
        let namesUsed = 0;
        for (const skill of rankSkills(skills, query)) {
            const line = entry(skill);
            if (used + line.length + 1 <= CATALOG_CHARS) {
                lines.push(line);
                used += line.length + 1;
            } else if (namesUsed + skill.name.length + 2 <= NAMES_CHARS) {
                names.push(skill.name);
                namesUsed += skill.name.length + 2;
            } else {
                more++;
            }
        }
    }
    return [
        'Skills provide specialized workflows through progressive disclosure.',
        'When the user explicitly names a skill or the task clearly matches one, call load_skill before acting and follow the returned instructions.',
        'Use load_skill again with a relative resource path when the SKILL.md references another file. Do not claim a skill was loaded until the tool succeeds.',
        'Available skills:',
        ...lines,
        ...(names.length ? [`More skills (load by name when one fits): ${names.join(', ')}${more ? `, and ${more} more` : ''}.`] : [])
    ].join('\n');
}

/** Skills matching more words of the query first (name matches count most), then by name. */
export function rankSkills<T extends SkillSummary>(skills: readonly T[], query: string): T[] {
    const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
    const score = (skill: SkillSummary) => {
        const name = skill.name.toLowerCase();
        const description = skill.description.toLowerCase();
        return words.reduce((total, word) => total + (name.includes(word) ? 3 : 0) + (description.includes(word) ? 1 : 0), 0);
    };
    return skills
        .map((skill) => ({ skill, score: score(skill) }))
        .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
        .map(({ skill }) => skill);
}

interface LoadSkillInput {
    name?: string;
    resource?: string;
}

/** load_skill: a skill's SKILL.md, or another file inside its folder. */
export function createLoadSkillTool(skills: readonly Skill[]): NovaTool<LoadSkillInput> {
    const catalog = new Map(skills.map((skill) => [skill.name, skill]));
    return {
        name: 'load_skill',
        description: 'Load a skill\'s instructions (SKILL.md) or a file it refers to.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Skill name from the list of available skills.' },
                resource: { type: 'string', description: 'Relative file inside the skill; defaults to SKILL.md.' }
            },
            required: ['name']
        },
        readOnly: true,
        async prepare(input) {
            return { title: `Load skill ${input.name ?? ''}`.trim() };
        },
        async invoke(input) {
            const name = typeof input.name === 'string' ? input.name : '';
            const skill = catalog.get(name);
            if (!skill) {
                throw new ToolInputError(`Unknown skill: ${name || '(missing name)'}.`);
            }
            const resource = typeof input.resource === 'string' && input.resource ? input.resource : 'SKILL.md';
            const target = path.resolve(skill.root, resource);
            const relative = path.relative(skill.root, target);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw new ToolInputError(`Skill resources must stay inside ${skill.root}.`);
            }
            const content = await fs.readFile(target, 'utf8').catch(() => {
                throw new ToolInputError(`Could not read ${relative || 'SKILL.md'} of skill ${name}.`);
            });
            const cut = content.length > MAX_SKILL_CHARS;
            return `Skill: ${skill.name}\nSkill root: ${skill.root}\nResource: ${relative || path.basename(target)}\n\n${cut ? content.slice(0, MAX_SKILL_CHARS) : content}${cut ? `\n\n[Cut at ${MAX_SKILL_CHARS} of ${content.length} characters.]` : ''}`;
        }
    };
}

/** Rough size of the skill list in every request (4 characters per token). */
export function estimateSkillsPromptTokens(skills: readonly SkillSummary[]): number {
    return Math.ceil((buildSkillsPrompt(skills)?.length ?? 0) / 4);
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
