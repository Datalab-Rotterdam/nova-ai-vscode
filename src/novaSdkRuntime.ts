type NovaSdkModule = typeof import('@datalabrotterdam/nova-sdk');

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

export async function loadNovaSdk(): Promise<NovaSdkModule> {
  return dynamicImport('@datalabrotterdam/nova-sdk') as Promise<NovaSdkModule>;
}

