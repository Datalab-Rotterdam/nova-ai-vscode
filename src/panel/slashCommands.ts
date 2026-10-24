/**
 * Slash commands of the Nova chat panel (`/clear`, `/compact`, …). Shared by the extension,
 * which runs them, and the webview, which suggests them while typing, so it must not import `vscode`.
 */

export type SlashCommandName = 'clear' | 'compact' | 'model' | 'rename' | 'commit' | 'review' | 'pr' | 'help';

export interface SlashCommand {
    /** A {@link SlashCommandName} for built-ins; any name for commands from files, skills or MCP servers. */
    name: string;
    /** Other names that run the same command. */
    aliases?: string[];
    /** Placeholder shown after the name, e.g. `<title>`; brackets mark it optional. */
    args?: string;
    description: string;
    /** Where a command that is not built in comes from (see ChatController.slashCommands). */
    source?: 'file' | 'skill' | 'mcp';
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
    { name: 'clear', aliases: ['new'], description: 'Start a new chat; this one stays in Chats' },
    { name: 'compact', args: '[focus]', description: 'Summarize the conversation to free up context' },
    { name: 'model', args: '[name]', description: 'Switch the model, or list the models' },
    { name: 'rename', args: '<title>', description: 'Rename this chat' },
    { name: 'commit', args: '[note]', description: 'Commit the staged changes with a message Nova writes' },
    { name: 'review', args: '[base]', description: 'Review the changes on this branch' },
    { name: 'pr', aliases: ['mr'], args: '[note]', description: 'Push this branch and open a pull request' },
    { name: 'help', description: 'Open the Nova AI help' }
];

export interface ParsedSlashCommand {
    command: SlashCommand;
    /** Text after the command name, trimmed. */
    args: string;
}

/** Suggestions shown at once; typing narrows them down. */
const MAX_SUGGESTIONS = 12;

/**
 * The command a message starts with, or undefined for an ordinary message (also `/unknown` or
 * a path). `extra` are the commands from files, skills and MCP servers; built-ins win a clash.
 */
export function parseSlashCommand(text: string, extra: readonly SlashCommand[] = []): ParsedSlashCommand | undefined {
    const match = /^\/([a-z0-9][\w:-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const command = findSlashCommand(match[1], extra);
    return command ? { command, args: (match[2] ?? '').trim() } : undefined;
}

/** Commands to suggest while the user types the first word of a message (`/`, `/co`, …). */
export function suggestSlashCommands(text: string, extra: readonly SlashCommand[] = []): SlashCommand[] {
    const match = /^\/([\w:-]*)$/.exec(text);
    if (!match) {
        return [];
    }
    const prefix = match[1].toLowerCase();
    return allCommands(extra)
        .filter((command) => [command.name, ...(command.aliases ?? [])].some((name) => name.toLowerCase().startsWith(prefix)))
        .slice(0, MAX_SUGGESTIONS);
}

function findSlashCommand(name: string, extra: readonly SlashCommand[]): SlashCommand | undefined {
    const wanted = name.toLowerCase();
    return allCommands(extra).find((command) => command.name.toLowerCase() === wanted || command.aliases?.includes(wanted));
}

/** Built-ins first, then the others without the names a built-in already has. */
function allCommands(extra: readonly SlashCommand[]): SlashCommand[] {
    const taken = new Set(SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
    return [...SLASH_COMMANDS, ...extra.filter((command) => !taken.has(command.name.toLowerCase()))];
}
