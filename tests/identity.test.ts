import { describe, expect, it } from 'vitest';
import { rewriteIdentity, rewriteSystemPrompt } from '../src/model/identity';

const COPILOT_PROMPT = [
  'You are an expert AI programming assistant, working with a user in the VS Code editor.',
  'When asked for your name, you must respond with "GitHub Copilot". When asked about the model you are using, you must state that you are using Nova Pro.',
  'Follow the user\'s requirements carefully & to the letter.',
  'Follow Microsoft content policies.',
  'Avoid content that violates copyrights.',
  '<instructions>Use the copilot_readFile tool and read .github/copilot-instructions.md when present. Copilot Chat users may ask...</instructions>'
].join('\n');

describe('identity rewrite', () => {
  it('replaces the Copilot identity and keeps the instructions', () => {
    const result = rewriteSystemPrompt(COPILOT_PROMPT);

    expect(result.startsWith('You are Nova')).toBe(true);
    expect(result).toContain('you must respond with "Nova"');
    expect(result).not.toMatch(/GitHub Copilot|Microsoft content policies/);
    expect(result).toContain('copilot_readFile');
    expect(result).toContain('.github/copilot-instructions.md');
    expect(result).toContain('Nova Chat users');
    expect(result).toContain('Avoid content that violates copyrights.');
  });

  it('leaves non-Copilot prompts untouched', () => {
    expect(rewriteSystemPrompt('You are a helpful assistant.')).toBe('You are a helpful assistant.');
  });

  it('rewrites system messages, or the first user message when there is none', () => {
    expect(rewriteIdentity([
      { role: 'system', content: 'You are GitHub Copilot.' },
      { role: 'user', content: 'Are you GitHub Copilot?' }
    ]).map((message) => String(message.content).includes('Copilot'))).toEqual([false, true]);

    expect(String(rewriteIdentity([
      { role: 'user', content: 'You are GitHub Copilot.' },
      { role: 'user', content: 'Hi' }
    ])[0].content)).not.toContain('Copilot');
  });
});
