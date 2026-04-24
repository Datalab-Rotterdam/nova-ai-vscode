import { NovaAI } from '@datalabrotterdam/nova-sdk';
import { getBaseUrl } from './config';

export class NovaSdkClientFactory {
  public async create(apiKey: string): Promise<NovaAI> {
    return new NovaAI({
      apiKey,
      baseUrl: getBaseUrl()
    });
  }
}
