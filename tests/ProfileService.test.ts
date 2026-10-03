import { describe, expect, it, vi } from 'vitest';
import { initialsOf, ProfileService } from '../src/services/ProfileService';

const image = (type: string, bytes = 4, status = 200) => new Response(new Uint8Array(bytes), {
  status,
  headers: { 'content-type': type, 'content-length': String(bytes) }
});

describe('profile avatar', () => {
  it('derives initials from a name or an email address', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Grace Brewster Hopper')).toBe('GH');
    expect(initialsOf('alice.smith@example.com')).toBe('A');
    expect(initialsOf('élodie')).toBe('É');
    expect(initialsOf(undefined)).toBeUndefined();
    expect(initialsOf('  ')).toBeUndefined();
  });

  it('turns the picture into a data URI and caches it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(image('image/png'));
    const profiles = new ProfileService(fetchImpl as never);

    const view = await profiles.view({ name: 'Ada Lovelace', avatarUrl: 'https://nova.example/avatar.png' });
    await profiles.view({ name: 'Ada Lovelace', avatarUrl: 'https://nova.example/avatar.png' });

    expect(view).toMatchObject({ name: 'Ada Lovelace', initials: 'AL', avatar: 'data:image/png;base64,AAAAAA==' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to initials for unsafe, oversized or failing pictures, and retries failures', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(image('image/svg+xml'))
      .mockResolvedValueOnce(image('image/png', 2_000_000))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(image('image/jpeg'));
    const profiles = new ProfileService(fetchImpl as never);

    expect((await profiles.view({ email: 'a@x.nl', avatarUrl: 'https://x/a.svg' }))?.avatar).toBeUndefined();
    expect((await profiles.view({ email: 'a@x.nl', avatarUrl: 'https://x/big.png' }))?.avatar).toBeUndefined();
    expect((await profiles.view({ email: 'a@x.nl', avatarUrl: 'https://x/c.jpg' }))?.avatar).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await profiles.view({ email: 'a@x.nl', avatarUrl: 'https://x/c.jpg' }))?.avatar).toMatch(/^data:image\/jpeg;base64,/);
    expect((await profiles.view({ email: 'a@x.nl', avatarUrl: 'file:///etc/passwd' }))?.avatar).toBeUndefined();
  });

  it('shows nothing until a profile exists', async () => {
    expect(await new ProfileService().view(undefined)).toBeUndefined();
  });
});
