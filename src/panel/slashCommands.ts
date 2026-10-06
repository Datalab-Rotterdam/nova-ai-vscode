/**
 * Slash commands of the Nova chat panel (`/clear`, `/compact`, …). Shared by the extension,
 * which runs them, and the webview, which suggests them while typing, so it must not import `vscode`.
 */

export type SlashCommandName = 'clear' | 'compact' | 'model' | 'rename' | 'help';

export interface SlashCommand {
    name: SlashCommandName;
    /** Other names that run the same command. */
    aliases?: string[];
    /** Placeholder shown after the name, e.g. `<title>`; brackets mark it optional. */
    args?: string;
    description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
    { name: 'clear', aliases: ['new'], description: 'Start a new chat; this one stays in Chats' },
    { name: 'compact', args: '[focus]', description: 'Summarize the conversation to free up context' },
    { name: 'model', args: '[name]', description: 'Switch the model, or list the models' },
    { name: 'rename', args: '<title>', description: 'Rename this chat' },
    { name: 'help', description: 'Open the Nova AI help' }
];

export interface ParsedSlashCommand {
    command: SlashCommand;
    /** Text after the command name, trimmed. */
    args: string;
}

/** The command a message starts with, or undefined for an ordinary message (also `/unknown` or a path). */
export function parseSlashCommand(text: string): ParsedSlashCommand | undefined {
    const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const command = findSlashCommand(match[1]);
    return command ? { command, args: (match[2] ?? '').trim() } : undefined;
}

/** Commands to suggest while the user types the first word of a message (`/`, `/co`, …). */
export function suggestSlashCommands(text: string): SlashCommand[] {
    const match = /^\/([\w-]*)$/.exec(text);
    if (!match) {
        return [];
    }
    const prefix = match[1].toLowerCase();
    return SLASH_COMMANDS.filter((command) => [command.name, ...(command.aliases ?? [])].some((name) => name.startsWith(prefix)));
}

function findSlashCommand(name: string): SlashCommand | undefined {
    const wanted = name.toLowerCase();
    return SLASH_COMMANDS.find((command) => command.name === wanted || command.aliases?.includes(wanted));
}
