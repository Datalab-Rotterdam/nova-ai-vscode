import * as path from 'node:path';
import * as vscode from 'vscode';
import { customizationRules, parseJsonc, resolveSyntaxColors, type SyntaxColors, type TokenRule } from './syntaxColors';

interface ThemeFile {
    include?: string;
    tokenColors?: TokenRule[] | string;
}

interface ThemeContribution {
    id?: string;
    label: string;
    path: string;
}

/** `include` chains deeper than this are ignored; real themes use one or two levels. */
const MAX_INCLUDE_DEPTH = 5;

/** The color theme in use: the preferred light/dark/high-contrast one when VS Code follows the OS. */
function activeThemeName(): string | undefined {
    const workbench = vscode.workspace.getConfiguration('workbench');
    if (vscode.workspace.getConfiguration('window').get<boolean>('autoDetectColorScheme')) {
        const kind = vscode.window.activeColorTheme.kind;
        const preferred = kind === vscode.ColorThemeKind.Light ? 'preferredLightColorTheme'
            : kind === vscode.ColorThemeKind.HighContrast ? 'preferredHighContrastColorTheme'
                : kind === vscode.ColorThemeKind.HighContrastLight ? 'preferredHighContrastLightColorTheme'
                    : 'preferredDarkColorTheme';
        const name = workbench.get<string>(preferred);
        if (name) {
            return name;
        }
    }
    return workbench.get<string>('colorTheme');
}

function findTheme(name: string): { theme: ThemeContribution; root: string } | undefined {
    for (const extension of vscode.extensions.all) {
        const themes = (extension.packageJSON as { contributes?: { themes?: ThemeContribution[] } }).contributes?.themes;
        const theme = themes?.find((candidate) => candidate.id === name || candidate.label === name);
        if (theme) {
            return { theme, root: extension.extensionPath };
        }
    }
    return undefined;
}

/** A theme file's token rules, those of the theme it includes first. */
async function readRules(file: string, depth = 0): Promise<TokenRule[]> {
    const text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString('utf8');
    const theme = parseJsonc(text) as ThemeFile;
    const inherited = theme.include && depth < MAX_INCLUDE_DEPTH
        ? await readRules(path.resolve(path.dirname(file), theme.include), depth + 1).catch(() => [])
        : [];
    // A string is a legacy .tmTheme file, which is not read.
    return [...inherited, ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : [])];
}

/**
 * What the active theme (plus the user's `editor.tokenColorCustomizations`) colors keywords,
 * strings and so on. Undefined when the theme file cannot be found or read; the chat then uses
 * the closest colors the webview has itself.
 */
export async function loadSyntaxColors(): Promise<SyntaxColors | undefined> {
    const name = activeThemeName();
    const found = name ? findTheme(name) : undefined;
    if (!name || !found) {
        return undefined;
    }
    try {
        const rules = await readRules(path.join(found.root, found.theme.path));
        const customizations = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations');
        const colors = resolveSyntaxColors([...rules, ...customizationRules(customizations, found.theme.label)]);
        return Object.keys(colors).length ? colors : undefined;
    } catch {
        return undefined;
    }
}

/** Calls `listener` when the theme or the token color settings change. */
export function onDidChangeSyntaxTheme(listener: () => void): vscode.Disposable {
    return vscode.Disposable.from(
        vscode.window.onDidChangeActiveColorTheme(listener),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('editor.tokenColorCustomizations')
                || event.affectsConfiguration('workbench.preferredDarkColorTheme') || event.affectsConfiguration('workbench.preferredLightColorTheme')) {
                listener();
            }
        })
    );
}
