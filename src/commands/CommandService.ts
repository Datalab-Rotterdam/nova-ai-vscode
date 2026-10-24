import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { scalar, splitFrontmatter } from '../agents/AgentService';

/**
 * Slash commands written as markdown files, in Claude Code's format (docs/NOVA_HOME.md,
 * "Commands"): the file's text is the prompt, `$ARGUMENTS` (or `$1`…`$9`) what the user typed
 * after the command.
 *
 * ```markdown
 * ---
 * description: Write tests for a file
 * argument-hint: <file>
 * ---
 * Write unit tests for $ARGUMENTS, in the style of the existing tests.
 * ```
 *
 * Folders, a later one replacing a command of the same name: `~/.claude/commands` (when
 * Claude's folders are on), `~/.nova-ai/commands`, then per workspace `.claude/commands` and
 * `.nova-ai/commands`. A file in a subfolder is named `folder:name`.
 */
export interface CustomCommand {
    name: string;
    description: string;
    argumentHint?: string;
    /** A model id to run the command with instead of the chat's model. */
    model?: string;
    prompt: string;
    path: string;
    scope: 'global' | 'project';
}

export interface CommandPaths {
    home: string;
    novaHome: string;
    workspaceRoots: string[];
    /** Also read Claude Code's `.claude/commands` folders. */
    includeClaude: boolean;
}

export function commandRoots(paths: CommandPaths): Array<{ dir: string; scope: CustomCommand['scope'] }> {
    const claude = (root: string) => paths.includeClaude ? [path.join(root, '.claude', 'commands')] : [];
    return [
        ...claude(paths.home).map((dir) => ({ dir, scope: 'global' as const })),
        { dir: path.join(paths.novaHome, 'commands'), scope: 'global' as const },
        ...paths.workspaceRoots.flatMap((root) => [...claude(root), path.join(root, '.nova-ai', 'commands')].map((dir) => ({ dir, scope: 'project' as const })))
    ];
}

export function findCommands(paths: CommandPaths): CustomCommand[] {
    const byName = new Map<string, CustomCommand>();
    for (const { dir, scope } of commandRoots(paths)) {
        for (const file of markdownFiles(dir)) {
            const name = path.relative(dir, file).replace(/\.md$/i, '').split(path.sep).join(':').toLowerCase();
            if (!/^[a-z0-9][\w:-]*$/.test(name)) {
                continue;
            }
            let content: string;
            try {
                content = readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            const { frontmatter, body } = splitFrontmatter(content);
            const model = scalar(frontmatter, 'model');
            byName.set(name, {
                name,
                description: scalar(frontmatter, 'description') || firstLine(body) || `Run ${name}`,
                ...(scalar(frontmatter, 'argument-hint') ? { argumentHint: scalar(frontmatter, 'argument-hint') } : {}),
                ...(model ? { model } : {}),
                prompt: body,
                path: file,
                scope
            });
        }
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The command's prompt with what the user typed: `$ARGUMENTS` for all of it, `$1`…`$9` for
 * single words; without placeholders the arguments are added at the end.
 */
export function expandCommand(command: Pick<CustomCommand, 'prompt'>, args: string): string {
    const words = args.split(/\s+/).filter(Boolean);
    const uses = /\$ARGUMENTS|\$[1-9]/.test(command.prompt);
    const expanded = command.prompt
        .replace(/\$ARGUMENTS/g, () => args)
        .replace(/\$([1-9])/g, (_, index: string) => words[Number(index) - 1] ?? '');
    return uses || !args ? expanded : `${expanded}\n\n${args}`;
}

function markdownFiles(dir: string): string[] {
    let entries: import('node:fs').Dirent[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            return markdownFiles(full);
        }
        return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [full] : [];
    });
}

function firstLine(text: string): string {
    return text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 80) ?? '';
}
