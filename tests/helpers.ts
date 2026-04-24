export class FakeSecrets {
  private readonly storeMap = new Map<string, string>();

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.storeMap.get(key));
  }

  public store(key: string, value: string): Promise<void> {
    this.storeMap.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.storeMap.delete(key);
    return Promise.resolve();
  }
}

export class FakeMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }

  public update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
    return Promise.resolve();
  }
}

