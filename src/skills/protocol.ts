/** Messages between the Skills page (webview) and the extension. */

export type SkillScopeName = 'global' | 'project';
export type SkillFolderName = 'nova' | '.agents' | '.claude' | '.codex';

export interface SkillRow {
    name: string;
    description: string;
    /** SKILL.md */
    path: string;
    /** Folder shown to the user, e.g. "~/.nova-ai/skills/review" or ".claude/skills/review". */
    location: string;
    scope: SkillScopeName;
    folder: SkillFolderName;
    /** Used in chats here. */
    enabled: boolean;
    offGlobally: boolean;
    offInProject: boolean;
    /** Location of the skill with the same name that is used instead. */
    replacedBy?: string;
    /** Bundled with a Nova app (e.g. "Nova AI Browser"), which keeps it up to date: read-only, can only be switched off. */
    bundledBy?: string;
}

export interface SkillsPageData {
    skills: SkillRow[];
    /** A folder is open, so there is a project scope. */
    hasProject: boolean;
    /** Where new skills go, per scope, for display. */
    folders: { global: string; project?: string };
    /** Skills in use and the rough size of their list in every request. */
    enabledCount: number;
    promptTokens: number;
}

export type SkillsCommand =
    | { command: 'skills/ready' }
    | { command: 'skills/toggle'; name: string; scope: SkillScopeName; enabled: boolean }
    | { command: 'skills/create'; scope: SkillScopeName }
    | { command: 'skills/open'; path: string }
    | { command: 'skills/reveal'; path: string }
    | { command: 'skills/move'; path: string; to: SkillScopeName }
    | { command: 'skills/delete'; path: string }
    | { command: 'skills/openFolder'; scope: SkillScopeName };
