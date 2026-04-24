type Listener<T> = (event: T) => unknown;

export class Disposable {
  public constructor(private readonly fn: () => void = () => {}) {}
  public dispose(): void {
    this.fn();
  }
}

export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  public readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };

  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

export class CancellationTokenSource {
  private emitter = new EventEmitter<void>();
  public readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: Listener<void>) => this.emitter.event(listener)
  };

  public cancel(): void {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }

  public dispose(): void {
    this.emitter.dispose();
  }
}

export const CancellationToken = {
  None: {
    isCancellationRequested: false,
    onCancellationRequested: () => new Disposable()
  }
};

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2
}

export class LanguageModelTextPart {
  public constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  public constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: object
  ) {}
}

export class LanguageModelToolResultPart {
  public constructor(
    public readonly callId: string,
    public readonly content: unknown[]
  ) {}
}

export class LanguageModelDataPart {
  public constructor(
    public readonly data: Uint8Array,
    public readonly mimeType: string
  ) {}
}

export class LanguageModelError extends Error {
  public constructor(message: string, public readonly code = 'Unknown') {
    super(message);
  }

  public static NoPermissions(message = 'NoPermissions'): LanguageModelError {
    return new LanguageModelError(message, 'NoPermissions');
  }

  public static Blocked(message = 'Blocked'): LanguageModelError {
    return new LanguageModelError(message, 'Blocked');
  }

  public static NotFound(message = 'NotFound'): LanguageModelError {
    return new LanguageModelError(message, 'NotFound');
  }
}

export const window = {
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined
  }),
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInputBox: async () => undefined,
  registerWebviewViewProvider: () => new Disposable()
};

export const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => new Disposable()
};

export const workspace = {
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue: T) => defaultValue
  })
};

