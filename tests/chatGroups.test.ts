import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore, type StoredSession } from '../src/panel/SessionStore';
import { filterChats, formatAge, groupChats } from '../src/panel/chatGroups';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Saturday 2026-10-03, 15:00 local time. */
const NOW = new Date(2026, 9, 3, 15, 0, 0).getTime();
const chat = (id: string, updatedAt: number) => ({ id, title: id, updatedAt });

describe('groupChats', () => {
  it('groups by Today, Yesterday, the last 7 and 30 days, then per month, newest first', () => {
    const groups = groupChats([
      chat('this-morning', new Date(2026, 9, 3, 8).getTime()),
      chat('just-now', NOW - 60_000),
      chat('last-night', new Date(2026, 9, 2, 23).getTime()),
      chat('monday', new Date(2026, 8, 28, 12).getTime()),
      chat('mid-september', new Date(2026, 8, 15).getTime()),
      chat('august-a', new Date(2026, 7, 20).getTime()),
      chat('august-b', new Date(2026, 7, 2).getTime()),
      chat('last-year', new Date(2025, 11, 31).getTime())
    ], NOW);

    expect(groups.map((group) => [group.key, group.chats.map((entry) => entry.id)])).toEqual([
      ['today', ['just-now', 'this-morning']],
      ['yesterday', ['last-night']],
      ['week', ['monday']],
      ['month', ['mid-september']],
      ['2026-08', ['august-a', 'august-b']],
      ['2025-12', ['last-year']]
    ]);
    expect(groups[0].label).toBe('Today');
    expect(groups[4].label).toBe(new Date(2026, 7, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  });

  it('leaves out empty groups', () => {
    expect(groupChats([], NOW)).toEqual([]);
    expect(groupChats([chat('old', NOW - 90 * DAY)], NOW).map((group) => group.key)).toEqual(['2026-07']);
  });
});

describe('formatAge', () => {
  it('is short for recent chats and a date for older ones', () => {
    expect(formatAge(NOW - 10_000, NOW)).toBe('now');
    expect(formatAge(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(formatAge(NOW - 3 * HOUR, NOW)).toBe('3h');
    expect(formatAge(NOW - 2 * DAY, NOW)).toBe('2d');
    expect(formatAge(new Date(2026, 6, 4).getTime(), NOW)).toBe(new Date(2026, 6, 4).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
    expect(formatAge(new Date(2024, 0, 9).getTime(), NOW)).toContain('2024');
    expect(formatAge(NOW + 5_000, NOW)).toBe('now');
  });
});

describe('filterChats', () => {
  it('matches every word of the query in the title, ignoring case', () => {
    const chats = [
      { id: 'a', title: 'Fix the login bug', updatedAt: 1 },
      { id: 'b', title: 'Explain login flow', updatedAt: 2 },
      { id: 'c', title: 'Release notes', updatedAt: 3 }
    ];
    expect(filterChats(chats, 'LOGIN').map((chat) => chat.id)).toEqual(['a', 'b']);
    expect(filterChats(chats, 'login  bug').map((chat) => chat.id)).toEqual(['a']);
    expect(filterChats(chats, '   ')).toHaveLength(3);
    expect(filterChats(chats, 'nothing')).toEqual([]);
  });
});

describe('SessionStore for the Chats page', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nova-chats-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const stored = (id: string, updatedAt: number): StoredSession => ({ id, title: `Chat ${id}`, createdAt: updatedAt, updatedAt, items: [], messages: [] });

  it('keeps every chat: there is no limit any more', async () => {
    const store = await SessionStore.open(dir);
    for (let index = 0; index < 60; index++) {
      await store.save(stored(`s${index}`, index));
    }
    expect(store.list()).toHaveLength(60);
    expect((await SessionStore.open(dir)).list()).toHaveLength(60);
    expect(await store.load('s0')).toBeDefined();
  });

  it('renames a chat without moving it in the list', async () => {
    const store = await SessionStore.open(dir);
    await store.save(stored('a', 1));
    await store.save(stored('b', 2));

    expect(await store.rename('a', 'Renamed')).toBe(true);
    expect(store.list()).toEqual([
      { id: 'b', title: 'Chat b', updatedAt: 2 },
      { id: 'a', title: 'Renamed', updatedAt: 1 }
    ]);
    expect((await store.load('a'))?.title).toBe('Renamed');
    expect((await SessionStore.open(dir)).list().find((summary) => summary.id === 'a')?.title).toBe('Renamed');
    expect(await store.rename('missing', 'x')).toBe(false);
  });
});
