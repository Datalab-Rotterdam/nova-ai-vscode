/*
 * Syntax colors of the active VS Code color theme, for code in chat answers. Webviews get the
 * theme's UI colors as CSS variables but not its token (TextMate) colors, so those are read from
 * the theme file by syntaxTheme.ts and boiled down here to a few roles (keyword, string, …).
 * Pure functions with no `vscode` import, so they can be tested.
 */

/** The kinds of token the chat colors; the webview maps highlight.js classes onto these. */
export const SYNTAX_ROLES = ['keyword', 'string', 'number', 'literal', 'builtin', 'function', 'type', 'property', 'variable', 'comment'] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];
export type SyntaxColors = Partial<Record<SyntaxRole, string>>;

export interface TokenRule {
    scope?: string | string[];
    settings?: { foreground?: string };
}

/** TextMate scopes that stand for each role, most specific first. */
const PROBES: Record<SyntaxRole, string[]> = {
    keyword: ['keyword.control', 'keyword', 'storage.type', 'storage'],
    string: ['string'],
    number: ['constant.numeric', 'constant'],
    literal: ['constant.language', 'constant'],
    builtin: ['support.function', 'support.type', 'support.class', 'support.constant', 'support'],
    function: ['entity.name.function', 'meta.function-call', 'support.function'],
    type: ['entity.name.type', 'entity.name.class', 'support.class', 'support.type'],
    property: ['variable.other.property', 'support.type.property-name', 'entity.other.attribute-name', 'meta.object-literal.key', 'variable.other.object.property'],
    variable: ['variable.parameter', 'variable.other', 'variable'],
    comment: ['comment']
};

/** Only plain hex colors go into CSS; anything else from a theme file is dropped. */
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** How well a rule's selector fits a scope: its length when the scope is it or inside it, else 0. */
function specificity(selector: string, scope: string): number {
    return scope === selector || scope.startsWith(`${selector}.`) ? selector.length : 0;
}

/** Flattens rules into (selector, color) pairs in order; descendant selectors (with spaces) are skipped. */
function flatten(rules: readonly TokenRule[]): Array<{ selector: string; color: string }> {
    const pairs: Array<{ selector: string; color: string }> = [];
    for (const rule of rules) {
        const color = rule.settings?.foreground?.trim();
        if (!color || !COLOR.test(color) || rule.scope === undefined) {
            continue;
        }
        const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope.split(',');
        for (const entry of scopes) {
            const selector = String(entry).trim();
            if (selector && !/\s/.test(selector)) {
                pairs.push({ selector, color });
            }
        }
    }
    return pairs;
}

/**
 * The color a theme gives each role. Rules are in theme order (included themes first, user
 * customizations last); the most specific selector wins, and the later rule on a tie.
 */
export function resolveSyntaxColors(rules: readonly TokenRule[]): SyntaxColors {
    const pairs = flatten(rules);
    const result: SyntaxColors = {};
    for (const role of SYNTAX_ROLES) {
        for (const probe of PROBES[role]) {
            let best = 0;
            let color: string | undefined;
            for (const pair of pairs) {
                const score = specificity(pair.selector, probe);
                if (score > 0 && score >= best) {
                    best = score;
                    color = pair.color;
                }
            }
            if (color) {
                result[role] = color;
                break;
            }
        }
    }
    return result;
}

/** The simple `editor.tokenColorCustomizations` keys and the scope each one sets. */
const SHORTCUTS: Record<string, string> = {
    comments: 'comment',
    strings: 'string',
    keywords: 'keyword',
    numbers: 'constant.numeric',
    types: 'entity.name.type',
    functions: 'entity.name.function',
    variables: 'variable'
};

/** Rules from the user's `editor.tokenColorCustomizations`: the general ones, then those for this theme. */
export function customizationRules(customizations: unknown, themeName: string): TokenRule[] {
    if (!customizations || typeof customizations !== 'object') {
        return [];
    }
    const config = customizations as Record<string, unknown>;
    const sections = [config, ...Object.entries(config)
        .filter(([key, value]) => key.startsWith('[') && key.includes(`[${themeName}]`) && value && typeof value === 'object')
        .map(([, value]) => value as Record<string, unknown>)];
    const rules: TokenRule[] = [];
    for (const section of sections) {
        for (const [key, scope] of Object.entries(SHORTCUTS)) {
            const value = section[key];
            const foreground = typeof value === 'string' ? value : (value as { foreground?: string } | undefined)?.foreground;
            if (typeof foreground === 'string') {
                rules.push({ scope, settings: { foreground } });
            }
        }
        if (Array.isArray(section.textMateRules)) {
            rules.push(...(section.textMateRules as TokenRule[]));
        }
    }
    return rules;
}

/** Parses JSON with comments and trailing commas, as theme files have. Throws on invalid input. */
export function parseJsonc(text: string): unknown {
    const out: string[] = [];
    let inString = false;
    for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
        const char = text[i]!;
        if (inString) {
            out.push(char);
            if (char === '\\') {
                out.push(text[++i] ?? '');
            } else if (char === '"') {
                inString = false;
            }
        } else if (char === '"') {
            inString = true;
            out.push(char);
        } else if (char === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out.push('\n');
        } else if (char === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 1;
            out.push(' ');
        } else if (char === '}' || char === ']') {
            // A comma right before a closing bracket is dropped.
            let at = out.length - 1;
            while (at >= 0 && /\s/.test(out[at]!)) at--;
            if (out[at] === ',') out.splice(at, 1);
            out.push(char);
        } else {
            out.push(char);
        }
    }
    return JSON.parse(out.join(''));
}
