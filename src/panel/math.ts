import katex from 'katex';

/*
 * LaTeX in chat answers. The webview's CSP forbids inline styles and KaTeX's HTML output
 * needs them (and its fonts), so math is rendered as MathML, which VS Code's browser draws
 * itself. Math is cut out before markdown and sanitizing and put back afterwards, so
 * neither touches it; KaTeX's own output is the only markup that comes from it.
 */

const MARK = 'novamath';
const TOKEN = new RegExp(`${MARK}(\\d+)x`, 'g');

interface Found {
    tex: string;
    display: boolean;
}

/** Splits text into code (kept as is) and the rest, where math is looked for. */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/** `$$…$$`, `\[…\]` (display) and `\(…\)`, `$…$` (inline). A `$` next to a space or a digit is money, not math. */
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\d])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g;

export interface ExtractedMath {
    text: string;
    math: Found[];
}

/** Replaces each math expression outside code with a placeholder word. */
export function extractMath(text: string): ExtractedMath {
    const math: Found[] = [];
    const replaced = text
        .split(CODE)
        .map((segment, index) => index % 2 === 1
            ? segment
            : segment.replace(MATH, (_match, doubled?: string, bracket?: string, paren?: string, single?: string) => {
                const display = doubled !== undefined || bracket !== undefined;
                const tex = (doubled ?? bracket ?? paren ?? single ?? '').trim();
                math.push({ tex, display });
                return display ? `\n\n${MARK}${math.length - 1}x\n\n` : `${MARK}${math.length - 1}x`;
            }))
        .join('');
    return { text: replaced, math };
}

/** Puts rendered math back where the placeholders are. Invalid LaTeX is shown as its source. */
export function restoreMath(html: string, math: readonly Found[]): string {
    if (!math.length) {
        return html;
    }
    return html.replace(TOKEN, (whole, index: string) => {
        const found = math[Number(index)];
        if (!found) {
            return whole;
        }
        try {
            const rendered = katex.renderToString(found.tex, { output: 'mathml', displayMode: found.display, throwOnError: true, trust: false, strict: 'ignore' });
            // data-tex is what the copy button puts on the clipboard (see Markdown.svelte).
            const tex = escapeAttribute(found.tex);
            return found.display
                ? `<div class="math-display" data-tex="${tex}">${rendered}</div>`
                : `<span class="math-inline" data-tex="${tex}">${rendered}</span>`;
        } catch {
            const source = found.tex.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            return `<code class="math-error">${source}</code>`;
        }
    });
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
