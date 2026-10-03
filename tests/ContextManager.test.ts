import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { estimateMessagesTokens, fitToBudget, pruneToolResults, TokenCalibration } from '../src/agent/ContextManager';

const { User, Assistant } = vscode.LanguageModelChatMessage;
const create = (role: vscode.LanguageModelChatMessageRole, content: unknown[]) =>
  new vscode.LanguageModelChatMessage(role, content as vscode.LanguageModelChatMessage['content']);

const big = (size: number) => 'x'.repeat(size * 3);
const call = (id: string) => new vscode.LanguageModelToolCallPart(id, 'read_file', { path: `${id}.ts` });
const result = (id: string, text: string) => new vscode.LanguageModelToolResultPart(id, [new vscode.LanguageModelTextPart(text)]);

/** System prompt, goal, then `rounds` tool rounds with large results. */
function conversation(rounds: number, resultTokens = 2_000): vscode.LanguageModelChatMessage[] {
  const messages = [User('system prompt'), User('goal: refactor the parser')];
  for (let round = 0; round < rounds; round++) {
    messages.push(Assistant([call(`c${round}`)]));
    messages.push(User([result(`c${round}`, big(resultTokens))]));
  }
  return messages;
}

function assertToolPairsIntact(messages: readonly vscode.LanguageModelChatMessage[]): void {
  messages.forEach((message, index) => {
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelToolResultPart) {
        const previous = messages[index - 1];
        expect(previous.content.some((p) => p instanceof vscode.LanguageModelToolCallPart && p.callId === part.callId)).toBe(true);
      }
    }
  });
}

describe('ContextManager', () => {
  it('leaves conversations under the threshold untouched', async () => {
    const messages = conversation(2, 100);
    const fitted = await fitToBudget(messages, create, { budget: 10_000, threshold: 0.8, pinned: 2 });

    expect(fitted.stage).toBe('none');
    expect(fitted.messages).toEqual(messages);
  });

  it('prunes old tool results first and keeps the recent ones intact', async () => {
    const messages = conversation(8, 1_500);
    const fitted = await fitToBudget(messages, create, { budget: 15_000, threshold: 0.8, pinned: 2 });

    expect(fitted.stage).toBe('pruned');
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(15_000 * 0.6);
    const last = fitted.messages[fitted.messages.length - 1].content[0] as vscode.LanguageModelToolResultPart;
    expect((last.content[0] as vscode.LanguageModelTextPart).value).toBe(big(1_500));
    const first = fitted.messages[3].content[0] as vscode.LanguageModelToolResultPart;
    expect((first.content[0] as vscode.LanguageModelTextPart).value).toContain('tokens truncated');
  });

  it('summarizes older turns when pruning is not enough, without splitting tool pairs', async () => {
    const messages = conversation(30, 300);
    let transcript = '';
    const fitted = await fitToBudget(messages, create, {
      budget: 4_000,
      threshold: 0.8,
      pinned: 2,
      summarize: async (text) => {
        transcript = text;
        return 'Goal: refactor. Progress: read 25 files.';
      }
    });

    expect(fitted.stage).toBe('summarized');
    expect(fitted.messages.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect((fitted.messages[2].content[0] as vscode.LanguageModelTextPart).value).toContain('Progress: read 25 files.');
    expect(transcript).toContain('[tool call] read_file');
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(4_000);
    assertToolPairsIntact(fitted.messages);
  });

  it('drops the oldest turns when no summary is available', async () => {
    const messages = conversation(30, 300);
    const fitted = await fitToBudget(messages, create, { budget: 4_000, threshold: 1, pinned: 2 });

    expect(fitted.stage).toBe('trimmed');
    expect(fitted.messages.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(4_000);
    assertToolPairsIntact(fitted.messages);
  });

  it('does not prune small tool results', () => {
    const messages = conversation(10, 50);
    expect(pruneToolResults(messages, create)).toEqual(messages);
  });

  it('calibrates estimates per model from reported prompt tokens', () => {
    const calibration = new TokenCalibration();
    calibration.record('nova-a', 1_000, 700);
    calibration.record('nova-a', 1_000, 700);
    calibration.record('nova-b', 1_000, 10_000);

    expect(calibration.ratio('nova-a')).toBeCloseTo(0.7);
    expect(calibration.ratio('nova-b')).toBe(2);
    expect(calibration.ratio('unknown')).toBe(1);
    expect(estimateMessagesTokens(conversation(1, 100), 0.5)).toBeLessThan(estimateMessagesTokens(conversation(1, 100)));
  });
});
