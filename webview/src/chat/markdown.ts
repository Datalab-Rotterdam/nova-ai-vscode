import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });

/** Renders model markdown to sanitized HTML. Raw HTML from the model is escaped, not rendered. */
export function renderMarkdown(text: string): string {
    const html = marked.parse(escapeRawHtml(text), { async: false });
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'img', 'form', 'input', 'button', 'iframe'],
        FORBID_ATTR: ['style']
    });
}

/** Escapes `<` outside code so model output cannot inject markup; code spans and fences are left to marked. */
function escapeRawHtml(text: string): string {
    return text
        .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
        .map((segment, index) => (index % 2 === 1 ? segment : segment.replace(/</g, '&lt;')))
        .join('');
}
