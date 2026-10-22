import { describe, expect, it } from 'vitest';
import { extractMath, restoreMath } from '../src/panel/math';

const roundTrip = (text: string) => {
    const { text: withoutMath, math } = extractMath(text);
    return { withoutMath, math, html: restoreMath(withoutMath, math) };
};

describe('math', () => {
    it('renders inline math as MathML', () => {
        const { html, math } = roundTrip('Score: $(30 / 90) \\times 9 + 1 = 3 + 1 = \\mathbf{4,0}$ done');
        expect(math).toHaveLength(1);
        expect(html).toContain('<math');
        expect(html).toContain('mathvariant="bold"');
        expect(html).not.toContain('style=');
        expect(html.startsWith('Score: ')).toBe(true);
    });

    it('keeps the LaTeX source for the copy button', () => {
        expect(roundTrip('$a<b$').html).toContain('data-tex="a&lt;b"');
        expect(roundTrip('$$x^2$$').html).toContain('data-tex="x^2"');
    });

    it('renders display math in its own block', () => {
        const { html } = roundTrip('$$\\frac{a}{b}$$');
        expect(html).toContain('class="math-display"');
        expect(html).toContain('<mfrac');
    });

    it('supports \\( \\) and \\[ \\]', () => {
        expect(roundTrip('\\(x^2\\)').html).toContain('<msup');
        expect(roundTrip('\\[x^2\\]').html).toContain('math-display');
    });

    it('leaves prices and code alone', () => {
        expect(extractMath('It costs $5 and $10 today').math).toHaveLength(0);
        expect(extractMath('use `$x$` and\n```\n$y$\n```').math).toHaveLength(0);
    });

    it('shows invalid LaTeX as its source', () => {
        expect(roundTrip('$\\frac{1$').html).toContain('math-error');
    });
});
