/** Types for the `<nova-pet>` web component in `./nova.js` (copied from ext/nova-pet). */

export type NovaPetState =
	'idle' | 'listening' | 'thinking' | 'responding' | 'success' | 'error' | 'resting';

export type NovaPetReaction =
	| 'joy'
	| 'love'
	| 'surprise'
	| 'hop'
	| 'wiggle'
	| 'nod'
	| 'shake'
	| 'yawn'
	| 'dizzy'
	| 'celebrate'
	| 'stretch'
	| 'lookaround';

export interface NovaPetElement extends HTMLElement {
	state: NovaPetState;
	/** Live audio or stream level, 0–1. */
	level: number;
	react(name: NovaPetReaction): this;
	/** Looks at an element or a point in client coordinates; null lets the eyes go free. */
	lookAt(target: HTMLElement | { x: number; y: number } | null): this;
	wake(): this;
	sleep(): this;
	readonly napping: boolean;
}

declare global {
	interface HTMLElementTagNameMap {
		'nova-pet': NovaPetElement;
	}
}

declare module 'svelte/elements' {
	interface SvelteHTMLElements {
		'nova-pet': HTMLAttributes<NovaPetElement> & {
			state?: NovaPetState;
			size?: string | number;
			theme?: 'auto' | 'light' | 'dark';
			autonomy?: 'on' | 'off';
			track?: 'pointer' | 'none';
			interactive?: 'true' | 'false';
			'sleep-after'?: string | number;
			sound?: 'on' | 'off';
			volume?: string | number;
		};
	}
}
