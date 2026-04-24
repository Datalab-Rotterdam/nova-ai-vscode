import type { NovaAI } from '@datalabrotterdam/nova-sdk';
import { getBaseUrl } from './config';
import { loadNovaSdk } from './novaSdkRuntime';

export class NovaSdkClientFactory {
  public async create(apiKey: string): Promise<NovaAI> {
    const { NovaAI } = await loadNovaSdk();

    return new NovaAI({
      apiKey,
      baseUrl: getBaseUrl()
    });
  }
}
