import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';
import { looksLikeFilePath } from '../../../src/panel/fileRefs';
import { highlightInline } from '../../../src/panel/inlineCode';
import { extractMath, restoreMath } from '../../../src/panel/math';

const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
        // Inline code gets token colors. marked hands the text over HTML-escaped; highlightInline escapes it again.
        // Fenced code is colored by its language tag; without a known tag it stays plain.
        code: ({ text, lang }) => {
            const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
            const body = language && hljs.getLanguage(language)
                ? hljs.highlight(text, { language, ignoreIllegals: true }).value
                : text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
            return `<pre><code${language ? ` class="language-${language.replace(/[^a-z0-9+#-]/g, '')}"` : ''}>${body}\n</code></pre>`;
        },
        codespan: ({ text }) => {
            const code = unescapeHtml(text);
            if (!looksLikeFilePath(code)) {
                return `<code>${highlightInline(code)}</code>`;
            }
            // A file reference is a link the extension opens (it has no href: `a.ts:12` is no valid one).
            const target = code.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
            return `<a class="file-ref" data-href="${target}" role="link" tabindex="0" title="Open ${target}"><code>${target}</code></a>`;
        }
    }
});

function unescapeHtml(text: string): string {
    return text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[name] ?? _);
}

/*
 * VS Code's webview host opens every clicked <a href> itself, even when the click was prevented,
 * so links keep their target in data-href instead. Markdown.svelte sends clicks to the extension,
 * which shows where a link goes before opening it.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') {
        return;
    }
    const href = node.getAttribute('href');
    node.removeAttribute('href');
    node.removeAttribute('target');
    if (href) {
        node.setAttribute('data-href', href);
        node.setAttribute('title', href);
        node.setAttribute('role', 'link');
        node.setAttribute('tabindex', '0');
    }
});

/** Renders model markdown to sanitized HTML. Raw HTML from the model is escaped, not rendered. */
export function renderMarkdown(text: string): string {
    const { text: withoutMath, math } = extractMath(text);
    const html = marked.parse(escapeRawHtml(withoutMath), { async: false });
    const clean = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'img', 'form', 'input', 'button', 'iframe'],
        FORBID_ATTR: ['style']
    });
    return restoreMath(clean, math);
}

/** Escapes `<` outside code so model output cannot inject markup; code spans and fences are left to marked. */
function escapeRawHtml(text: string): string {
    return text
        .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
        .map((segment, index) => (index % 2 === 1 ? segment : segment.replace(/</g, '&lt;')))
        .join('');
}
