import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_PAGE } from '../src/core/help';
import { parseSlashCommand, SLASH_COMMANDS, suggestSlashCommands } from '../src/panel/slashCommands';

describe('slash commands', () => {
  it('parses known commands, aliases and their arguments', () => {
    expect(parseSlashCommand('/compact')).toMatchObject({ command: { name: 'compact' }, args: '' });
    expect(parseSlashCommand('  /COMPACT  keep the plan\nand paths ')).toMatchObject({ command: { name: 'compact' }, args: 'keep the plan\nand paths' });
    expect(parseSlashCommand('/new')).toMatchObject({ command: { name: 'clear' } });
  });

  it('leaves ordinary messages alone', () => {
    expect(parseSlashCommand('clear')).toBeUndefined();
    expect(parseSlashCommand('/unknown')).toBeUndefined();
    expect(parseSlashCommand('/usr/bin is missing')).toBeUndefined();
    expect(parseSlashCommand('please /clear')).toBeUndefined();
  });

  it('suggests commands while the first word is typed', () => {
    expect(suggestSlashCommands('/').map((command) => command.name)).toEqual(['clear', 'compact', 'model', 'rename', 'help']);
    expect(suggestSlashCommands('/c').map((command) => command.name)).toEqual(['clear', 'compact']);
    expect(suggestSlashCommands('/ne').map((command) => command.name)).toEqual(['clear']);
    expect(suggestSlashCommands('/compact ')).toEqual([]);
    expect(suggestSlashCommands('/etc')).toEqual([]);
    expect(suggestSlashCommands('hi /c')).toEqual([]);
  });

  it('are all documented on the help page', () => {
    const help = readFileSync(join(__dirname, '..', ...HELP_PAGE), 'utf8');
    for (const command of SLASH_COMMANDS) {
      expect(help).toContain(`| \`/${[command.name, command.args].filter(Boolean).join(' ')}\``);
      for (const alias of command.aliases ?? []) {
        expect(help).toContain(`\`/${alias}\``);
      }
    }
  });
});
