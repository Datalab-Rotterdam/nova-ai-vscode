/** The image shown full size in the overlay; `undefined` when it is closed. */
export const viewer = $state<{ image?: { src: string; name: string } }>({});

export function openImage(src: string, name: string): void {
    viewer.image = { src, name };
}

export function closeImage(): void {
    viewer.image = undefined;
}
