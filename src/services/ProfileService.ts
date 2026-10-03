import type { ProfileView, UserProfile } from '../core/types';

const MAX_AVATAR_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Turns the user's profile into what the webview shows. The picture is downloaded here
 * and passed as a data: URI, so the webview's content security policy can keep blocking
 * remote images. Pictures are cached in memory per URL; failures fall back to initials.
 */
export class ProfileService {
    private readonly avatars = new Map<string, Promise<string | undefined>>();

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {
    }

    public async view(profile: UserProfile | undefined): Promise<ProfileView | undefined> {
        if (!profile) {
            return undefined;
        }
        const name = profile.name?.trim() || undefined;
        const email = profile.email?.trim() || undefined;
        return {
            name,
            email,
            initials: initialsOf(name ?? email),
            avatar: profile.avatarUrl ? await this.avatar(profile.avatarUrl) : undefined
        };
    }

    private avatar(url: string): Promise<string | undefined> {
        let pending = this.avatars.get(url);
        if (!pending) {
            pending = this.download(url);
            this.avatars.set(url, pending);
            // Retry a failed download next time instead of caching the failure forever.
            void pending.then((result) => {
                if (!result) {
                    this.avatars.delete(url);
                }
            });
        }
        return pending;
    }

    private async download(url: string): Promise<string | undefined> {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return undefined;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return undefined;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await this.fetchImpl(parsed, { signal: controller.signal, redirect: 'follow' });
            const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
            const length = Number(response.headers.get('content-length') ?? 0);
            // SVG can carry scripts; only raster formats are accepted.
            if (!response.ok || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(type) || length > MAX_AVATAR_BYTES) {
                return undefined;
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > MAX_AVATAR_BYTES) {
                return undefined;
            }
            return `data:${type};base64,${bytes.toString('base64')}`;
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    }
}

/** "Ada Lovelace" → "AL", "ada@example.com" → "A". */
export function initialsOf(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const base = value.includes('@') && !value.includes(' ') ? value.split('@')[0] : value;
    const words = base.split(/[\s._-]+/).filter((word) => /\p{L}|\p{N}/u.test(word));
    if (!words.length) {
        return undefined;
    }
    const letters = value.includes('@') && !value.includes(' ')
        ? [words[0]]
        : words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
    return letters.map((word) => [...word][0].toUpperCase()).join('');
}
