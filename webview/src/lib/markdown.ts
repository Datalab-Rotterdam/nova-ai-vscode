import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const defaultLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, self) =>
  self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noreferrer noopener');
  return defaultLinkOpen(tokens, index, options, env, self);
};

export function renderMarkdown(value: string): string {
  return markdown.render(value);
}
