import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMemento, FakeSecrets } from './helpers';
import { NovaSessionService } from '../src/novaSessionService';
import { NovaDiagnostics } from '../src/novaDiagnostics';

describe('NovaSessionService', () => {
  const secrets = new FakeSecrets();
  const globalState = new FakeMemento();
  const diagnostics = new NovaDiagnostics();

  beforeEach(async () => {
    await secrets.delete('nova.apiKey');
  });

  it('stores a validated key and account summary on sign-in', async () => {
    const factory = {
      create: vi.fn(() => ({
        baseUrl: 'https://api.example.test/v1',
        providers: { list: vi.fn().mockResolvedValue({ data: [{ name: 'Nova Runtime' }] }) },
        models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'nova-pro', created: 1, owned_by: 'nova' }] }) }
      }))
    };

    const service = new NovaSessionService(
      { secrets, globalState },
      factory as never,
      diagnostics
    );

    const snapshot = await service.signIn('secret-key');
    expect(await service.getApiKey()).toBe('secret-key');
    expect(snapshot.connectionHealth).toBe('connected');
    expect(snapshot.accountSummary?.modelCount).toBe(1);
  });

  it('clears state on sign-out', async () => {
    const factory = {
      create: vi.fn(() => ({
        baseUrl: 'https://api.example.test/v1',
        providers: { list: vi.fn().mockResolvedValue({ data: [{ name: 'Nova Runtime' }] }) },
        models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'nova-pro', created: 1, owned_by: 'nova' }] }) }
      }))
    };

    const service = new NovaSessionService(
      { secrets, globalState },
      factory as never,
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
    const factory = {
      create: vi.fn(() => ({
        baseUrl: 'https://api.example.test/v1',
        providers: { list: vi.fn().mockRejectedValue(new Error('expired key')) },
        models: { list: vi.fn().mockResolvedValue({ data: [] }) }
      }))
    };

    const service = new NovaSessionService(
      { secrets, globalState },
      factory as never,
      diagnostics
    );

    await secrets.store('nova.apiKey', 'persisted-key');
    const snapshot = await service.validateExistingSession();

    expect(snapshot.connectionHealth).toBe('degraded');
    expect(snapshot.lastError).toContain('expired key');
  });
});

