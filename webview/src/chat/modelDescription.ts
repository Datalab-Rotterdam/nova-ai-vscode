/** Inline tags kept in a model description; any other tag is dropped, block tags become a space. */
const KEEP: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", code: "code" };
const BREAK = new Set(["p", "br", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4"]);
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity]);

/** Safe HTML for a one-line description: only strong, em and code survive, everything else is escaped text. */
export function descriptionHtml(source: string): string {
  const html = source
    .split(/(<\/?[a-z][a-z0-9]*\b[^>]*>)/i)
    .map((part, index) => {
      if (index % 2 === 0) {
        return escape(decode(part));
      }
      const [, closing, name] = /^<(\/?)([a-z0-9]+)/i.exec(part)!;
      const tag = name.toLowerCase();
      if (KEEP[tag]) {
        return `<${closing}${KEEP[tag]}>`;
      }
      return BREAK.has(tag) ? " " : "";
    })
    .join("");
  return html.replace(/\s+/g, " ").trim();
}

/** The same text without any markup, for tooltips. */
export function descriptionText(source: string): string {
  return decode(source.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, " ")).replace(/\s+/g, " ").trim();
}
