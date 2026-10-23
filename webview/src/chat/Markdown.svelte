<script lang="ts">
    import {renderMarkdown} from './markdown';

    let {text, onLink, onTable, onCode}: {
        text: string;
        /** A link was clicked; the extension decides where it may go and asks first for external ones. */
        onLink?: (href: string, text: string) => void;
        /** A table's save button was used; the extension asks where to put the file. */
        onTable?: (format: 'csv' | 'xlsx', rows: string[][]) => void;
        /** A code block's open button was used; the extension shows it as a file in an editor. */
        onCode?: (code: string, language: string) => void;
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
                if (onCode) {
                    const open = document.createElement('button');
                    open.className = 'open-code codicon codicon-go-to-file';
                    open.title = 'Open in editor';
                    open.setAttribute('aria-label', 'Open code in editor');
                    open.addEventListener('click', () => {
                        const code = pre.querySelector('code');
                        const language = /(?:^|\s)language-([\w+#-]+)/.exec(code?.className ?? '')?.[1] ?? '';
                        onCode(code?.textContent ?? pre.textContent ?? '', language);
                    });
                    pre.append(open);
                }
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
        // Copy / CSV / Excel buttons above each table, shown on hover or focus.
        const rowsOf = (table: HTMLTableElement): string[][] =>
            [...table.rows].map((row) => [...row.cells].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()));
        const decorateTables = () => {
            for (const table of node.querySelectorAll('table')) {
                if (table.parentElement?.classList.contains('table-box')) {
                    continue;
                }
                const box = document.createElement('div');
                box.className = 'table-box';
                const bar = document.createElement('div');
                bar.className = 'table-tools';
                const add = (icon: string, label: string, title: string, run: (button: HTMLButtonElement) => void) => {
                    const button = document.createElement('button');
                    button.className = 'table-tool';
                    button.title = title;
                    button.setAttribute('aria-label', title);
                    const glyph = document.createElement('span');
                    glyph.className = `codicon codicon-${icon}`;
                    button.append(glyph, label);
                    button.addEventListener('click', () => run(button));
                    bar.append(button);
                };
                add('copy', 'Copy', 'Copy table as Markdown', (button) => {
                    const [head = [], ...body] = rowsOf(table);
                    const line = (row: string[]) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;
                    const markdown = [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
                    void navigator.clipboard.writeText(markdown);
                    const glyph = button.firstElementChild;
                    glyph?.classList.replace('codicon-copy', 'codicon-check');
                    setTimeout(() => glyph?.classList.replace('codicon-check', 'codicon-copy'), 1200);
                });
                if (onTable) {
                    add('file', 'CSV', 'Save table as CSV', () => onTable('csv', rowsOf(table)));
                    add('table', 'Excel', 'Save table as Excel workbook', () => onTable('xlsx', rowsOf(table)));
                }
                table.replaceWith(box);
                box.append(bar, table);
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
            decorateTables();
        });
        observer.observe(node, {childList: true, subtree: true});
        node.addEventListener('click', onClick);
        node.addEventListener('keydown', onKeyDown);
        decorate();
        decorateMath();
        decorateTables();
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

    /*
     * Token colors of code. --nova-syn-<role> is the active editor theme's own color for that kind
     * of token (set in App.svelte from the theme file); where the theme gives none, or it could not
     * be read, the closest theme variable stands in. Inline code uses the .hl-* classes, fenced
     * code the highlight.js ones.
     */
    :global(.hl-keyword),
    :global(.hljs-keyword),
    :global(.hljs-selector-tag),
    :global(.hljs-doctag),
    :global(.hljs-meta .hljs-keyword) { color: var(--nova-syn-keyword, var(--vscode-debugTokenExpression-name, #c586c0)); }
    :global(.hl-string),
    :global(.hljs-string),
    :global(.hljs-regexp),
    :global(.hljs-template-variable),
    :global(.hljs-meta .hljs-string),
    :global(.hljs-addition) { color: var(--nova-syn-string, var(--vscode-debugTokenExpression-string, #ce9178)); }
    :global(.hl-number),
    :global(.hljs-number),
    :global(.hljs-symbol),
    :global(.hljs-bullet) { color: var(--nova-syn-number, var(--vscode-debugTokenExpression-number, #b5cea8)); }
    :global(.hl-literal),
    :global(.hljs-literal) { color: var(--nova-syn-literal, var(--vscode-debugTokenExpression-boolean, #4e94ce)); }
    :global(.hljs-built_in),
    :global(.hljs-variable.language_) { color: var(--nova-syn-builtin, var(--vscode-debugTokenExpression-boolean, #4e94ce)); }
    :global(.hl-fn),
    :global(.hljs-title.function_),
    :global(.hljs-function .hljs-title),
    :global(.hljs-section) { color: var(--nova-syn-function, var(--vscode-symbolIcon-functionForeground, #b180d7)); }
    :global(.hl-type),
    :global(.hljs-title.class_),
    :global(.hljs-type),
    :global(.hljs-title) { color: var(--nova-syn-type, var(--vscode-symbolIcon-classForeground, #ee9d28)); }
    :global(.hl-flag),
    :global(.hljs-attr),
    :global(.hljs-attribute),
    :global(.hljs-property),
    :global(.hljs-name),
    :global(.hljs-selector-class),
    :global(.hljs-selector-id) { color: var(--nova-syn-property, var(--vscode-symbolIcon-propertyForeground, var(--vscode-textLink-foreground))); }
    :global(.hljs-params),
    :global(.hljs-variable) { color: var(--nova-syn-variable, inherit); }
    :global(.hl-comment),
    :global(.hljs-comment),
    :global(.hljs-quote),
    :global(.hljs-meta) { color: var(--nova-syn-comment, var(--nova-muted)); font-style: italic; }
    :global(.hljs-deletion) { color: var(--nova-error); }
    :global(.hljs-emphasis) { font-style: italic; }
    :global(.hljs-strong) { font-weight: bold; }

    :global(pre code) {
      padding: 0;
      background: none;
      color: var(--vscode-editor-foreground, var(--nova-fg));
      font-size: var(--vscode-editor-font-size, 12px);
      white-space: pre;
    }

    :global(pre .copy),
    :global(pre .open-code) {
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

    :global(pre .open-code) {
      right: 28px;
    }

    :global(pre:hover .copy),
    :global(pre:hover .open-code),
    :global(pre .copy:focus-visible),
    :global(pre .open-code:focus-visible) {
      opacity: 1;
    }

    :global(a) {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;
    }

    /* A file named in code (`src/app.ts:12`): a link, but quiet until hovered. */
    :global(a.file-ref) code {
      color: inherit;
    }

    :global(a.file-ref:hover code),
    :global(a.file-ref:focus-visible code) {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      text-decoration: underline;
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

    :global(.table-box) {
      margin: 0 0 8px;
      overflow-x: auto;

      :global(table) {
        margin: 0;
      }
    }

    :global(.table-tools) {
      display: flex;
      justify-content: flex-end;
      gap: 2px;
      margin-bottom: 2px;
      opacity: 0;
      transition: opacity 0.12s;
    }

    :global(.table-box:hover .table-tools),
    :global(.table-box:focus-within .table-tools) {
      opacity: 1;
    }

    :global(.table-tool) {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border: 0;
      border-radius: var(--nova-radius);
      background: transparent;
      color: var(--nova-muted);
      font: inherit;
      font-size: 0.9em;
      cursor: pointer;

      &:hover {
        background: var(--nova-hover);
        color: var(--nova-hover-fg);
      }
    }

    :global(th),
    :global(td) {
      padding: 3px 8px;
      border: 1px solid var(--nova-subtle-border);
    }
  }
</style>
