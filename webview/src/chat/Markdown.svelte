<script lang="ts">
    import {renderMarkdown} from './markdown';

    let {text, onLink}: {
        text: string;
        /** A link was clicked; the extension decides where it may go and asks first for external ones. */
        onLink?: (href: string, text: string) => void;
    } = $props();

    const html = $derived(renderMarkdown(text));

    // Copy buttons for code blocks, added after each render.
    function enhance(node: HTMLElement) {
        const decorate = () => {
            for (const pre of node.querySelectorAll('pre')) {
                if (pre.querySelector('.copy')) {
                    continue;
                }
                const button = document.createElement('button');
                button.className = 'copy codicon codicon-copy';
                button.title = 'Copy';
                button.setAttribute('aria-label', 'Copy code');
                button.addEventListener('click', () => {
                    void navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
                    button.classList.replace('codicon-copy', 'codicon-check');
                    setTimeout(() => button.classList.replace('codicon-check', 'codicon-copy'), 1200);
                });
                pre.append(button);
            }
        };
        // A copy button on each equation, shown on hover; it copies the LaTeX source.
        const decorateMath = () => {
            for (const math of node.querySelectorAll<HTMLElement>('[data-tex]')) {
                if (math.querySelector('.math-copy')) {
                    continue;
                }
                const button = document.createElement('button');
                button.className = 'math-copy codicon codicon-copy';
                button.title = 'Copy LaTeX';
                button.setAttribute('aria-label', 'Copy LaTeX');
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void navigator.clipboard.writeText(math.dataset.tex ?? '');
                    button.classList.replace('codicon-copy', 'codicon-check');
                    setTimeout(() => button.classList.replace('codicon-check', 'codicon-copy'), 1200);
                });
                math.append(button);
            }
        };
        // Links carry data-href, not href (see markdown.ts); the extension opens them.
        const linkOf = (event: Event) => {
            const link = (event.target as Element | null)?.closest?.('a[data-href]');
            return link && node.contains(link) ? link : undefined;
        };
        const open = (event: Event, link: Element) => {
            event.preventDefault();
            event.stopPropagation();
            onLink?.(link.getAttribute('data-href') ?? '', link.textContent ?? '');
        };
        const onClick = (event: MouseEvent) => {
            const link = linkOf(event);
            if (link) {
                open(event, link);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            const link = event.key === 'Enter' ? linkOf(event) : undefined;
            if (link) {
                open(event, link);
            }
        };
        const observer = new MutationObserver(() => {
            decorate();
            decorateMath();
        });
        observer.observe(node, {childList: true, subtree: true});
        node.addEventListener('click', onClick);
        node.addEventListener('keydown', onKeyDown);
        decorate();
        decorateMath();
        return {
            destroy: () => {
                observer.disconnect();
                node.removeEventListener('click', onClick);
                node.removeEventListener('keydown', onKeyDown);
            }
        };
    }
</script>

<div class="markdown" use:enhance>{@html html}</div>

<style lang="scss">
  .markdown {
    overflow-wrap: anywhere;

    :global(.math-display) {
      position: relative;
      margin: 0.6em 0;
      overflow-x: auto;
      text-align: center;
    }

    :global(.math-inline) {
      position: relative;
    }

    /* Subtle: only on hover or keyboard focus, in the corner so the equation does not shift. */
    :global(.math-copy) {
      position: absolute;
      top: -0.9em;
      right: -0.6em;
      padding: 1px 3px;
      border: 0;
      border-radius: var(--nova-radius);
      background: var(--nova-surface);
      color: var(--nova-muted);
      font-size: 12px;
      line-height: 1;
      opacity: 0;
      cursor: pointer;
      transition: opacity 0.12s;
    }

    :global(.math-display .math-copy) {
      top: 2px;
      right: 2px;
    }

    :global([data-tex]:hover .math-copy),
    :global(.math-copy:focus-visible) {
      opacity: 1;
    }

    :global(.math-copy:hover) {
      color: var(--nova-fg);
    }

    :global(.math-error) {
      color: var(--nova-error);
    }

    :global(math) {
      font-size: 1.05em;
    }

    line-height: 1.5;

    :global(> :first-child) {
      margin-top: 0;
    }

    :global(> :last-child) {
      margin-bottom: 0;
    }

    :global(p),
    :global(ul),
    :global(ol),
    :global(pre),
    :global(blockquote),
    :global(table) {
      margin: 0 0 8px;
    }

    :global(ul),
    :global(ol) {
      padding-left: 20px;
    }

    :global(h1),
    :global(h2),
    :global(h3),
    :global(h4) {
      margin: 12px 0 6px;
      font-size: 1em;
      font-weight: 600;
    }

    :global(code) {
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--nova-fg) 10%, transparent));
      font-family: var(--nova-mono);
      font-size: 0.92em;
    }

    :global(pre) {
      position: relative;
      overflow-x: auto;
      padding: 8px 10px;
      border: 1px solid var(--nova-subtle-border);
      border-radius: var(--nova-radius);
      background: var(--vscode-textCodeBlock-background, var(--nova-input-bg));
    }

    :global(pre code) {
      padding: 0;
      background: none;
      color: var(--vscode-editor-foreground, var(--nova-fg));
      font-size: var(--vscode-editor-font-size, 12px);
      white-space: pre;
    }

    :global(pre .copy) {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 3px;
      border: 0;
      border-radius: var(--nova-radius);
      background: var(--nova-bg);
      color: var(--nova-muted);
      cursor: pointer;
      opacity: 0;
    }

    :global(pre:hover .copy),
    :global(pre .copy:focus-visible) {
      opacity: 1;
    }

    :global(a) {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;
    }

    :global(a:hover),
    :global(a:focus-visible) {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      text-decoration: underline;
    }

    :global(blockquote) {
      padding-left: 10px;
      border-left: 3px solid var(--vscode-textBlockQuote-border, var(--nova-subtle-border));
      color: var(--nova-muted);
    }

    :global(table) {
      border-collapse: collapse;
    }

    :global(th),
    :global(td) {
      padding: 3px 8px;
      border: 1px solid var(--nova-subtle-border);
    }
  }
</style>
