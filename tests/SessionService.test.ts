import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMemento, FakeSecrets } from './helpers';
import { SessionService } from '../src/services/SessionService';
import { Diagnostics } from '../src/core/diagnostics';

const { mockNovaAI } = vi.hoisted(() => ({
  mockNovaAI: vi.fn()
}));

vi.mock('@datalabrotterdam/nova-sdk', () => ({
  NovaAI: mockNovaAI
}));

describe('SessionService', () => {
  let secrets: FakeSecrets;
  let globalState: FakeMemento;
  let diagnostics: Diagnostics;

  beforeEach(() => {
    secrets = new FakeSecrets();
    globalState = new FakeMemento();
    diagnostics = new Diagnostics();
    mockNovaAI.mockReset();
  });

  it('stores a validated key and account summary on sign-in', async () => {
    mockNovaAI.mockImplementation(() => ({
      baseUrl: 'https://api.example.test/v1',
      providers: { list: vi.fn().mockResolvedValue({ data: [{ name: 'Nova Runtime' }] }) },
      models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'nova-pro', created: 1, owned_by: 'nova' }] }) }
    }));

    const service = new SessionService(
      { secrets, globalState },
      diagnostics
    );

    const snapshot = await service.signIn('secret-key');

    expect(mockNovaAI).toHaveBeenCalledWith({ apiKey: 'secret-key' });
    expect(await service.getApiKey()).toBe('secret-key');
    expect(snapshot.connectionHealth).toBe('connected');
    expect(snapshot.accountSummary?.modelCount).toBe(1);
  });

  it('clears state on sign-out', async () => {
    mockNovaAI.mockImplementation(() => ({
      baseUrl: 'https://api.example.test/v1',
      providers: { list: vi.fn().mockResolvedValue({ data: [{ name: 'Nova Runtime' }] }) },
      models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'nova-pro', created: 1, owned_by: 'nova' }] }) }
    }));

    const service = new SessionService(
      { secrets, globalState },
      diagnostics
    );

    await service.signIn('secret-key');
    await service.signOut();
    const snapshot = await service.getSnapshot();

    expect(await service.getApiKey()).toBeUndefined();
    expect(snapshot.connectionHealth).toBe('signedOut');
    expect(snapshot.accountSummary).toBeUndefined();
  });

  it('marks stored sessions as degraded when validation fails', async () => {
    mockNovaAI.mockImplementation(() => ({
      baseUrl: 'https://api.example.test/v1',
      providers: { list: vi.fn().mockRejectedValue(new Error('Invalid token: expired key')) },
      models: { list: vi.fn().mockResolvedValue({ data: [] }) }
    }));

    const service = new SessionService(
      { secrets, globalState },
      diagnostics
    );

    await secrets.store('nova.apiKey', 'persisted-key');
    const snapshot = await service.validateExistingSession();

    expect(mockNovaAI).toHaveBeenCalledWith({ apiKey: 'persisted-key' });
    expect(snapshot.connectionHealth).toBe('degraded');
    expect(snapshot.lastError).toContain('Invalid token');
  });
});
