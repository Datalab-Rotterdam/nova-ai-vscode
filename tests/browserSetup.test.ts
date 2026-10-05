import { describe, expect, it } from 'vitest';
import { parseSetupOutput, runBrowserSetup, type ExecFile } from '../src/browser/BrowserSetup';

const result = {
    version: '0.1.0',
    usedThisVersion: true,
    changed: true,
    browsers: ['Microsoft Edge'],
    newBrowsers: ['Microsoft Edge'],
    node: '/usr/local/bin/node',
    skills: ['/home/me/.nova-ai/skills/nova-browser']
};

describe('browser setup', () => {
    it('reads the installer\'s JSON line, ignoring warnings before it', () => {
        expect(parseSetupOutput(`Skipped /x: a different skill\n${JSON.stringify(result)}\n`)).toEqual(result);
        expect(() => parseSetupOutput('oops')).toThrow(/no result/);
    });

    it('runs the bundled installer with VS Code\'s runtime as Node, in Nova\'s home', async () => {
        let call: { file: string; args: string[]; env: NodeJS.ProcessEnv } | undefined;
        const run: ExecFile = async (file, args, options) => {
            call = { file, args, env: options.env };
            return JSON.stringify(result);
        };

        expect(await runBrowserSetup('/ext', '/home/me/.nova-ai', run)).toEqual(result);
        expect(call?.file).toBe(process.execPath);
        expect(call?.args).toEqual(['/ext/resources/browser-host/dist/cli.js', 'install', '--auto', '--json']);
        expect(call?.env.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(call?.env.NOVA_AI_HOME).toBe('/home/me/.nova-ai');
    });
});
