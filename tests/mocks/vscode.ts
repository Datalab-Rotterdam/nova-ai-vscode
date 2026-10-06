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

  public static text(value: string, mimeType = 'text/plain'): LanguageModelDataPart {
    return new LanguageModelDataPart(new TextEncoder().encode(value), mimeType);
  }

  public static json(value: unknown, mimeType = 'text/x-json'): LanguageModelDataPart {
    return new LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(value)), mimeType);
  }
}

export class ChatRequestTurn {
  public constructor(
    public readonly prompt: string,
    public readonly command?: string
  ) {}
}

export class ChatResponseMarkdownPart {
  public readonly value: { value: string };
  public constructor(value: string) {
    this.value = { value };
  }
}

export class ChatResponseTurn {
  public constructor(
    public readonly response: unknown[],
    public readonly result: { metadata?: Record<string, unknown> }
  ) {}
}

export class LanguageModelChatMessage {
  public constructor(
    public readonly role: LanguageModelChatMessageRole,
    content: string | unknown[],
    public readonly name?: string
  ) {
    this.content = typeof content === 'string' ? [new LanguageModelTextPart(content)] : content;
  }

  public readonly content: unknown[];

  public static User(content: string | unknown[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content);
  }

  public static Assistant(content: string | unknown[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content);
  }
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
  showTextDocument: async () => undefined,
  registerWebviewViewProvider: () => new Disposable()
};

export const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => new Disposable()
};

export class Uri {
  private constructor(public readonly scheme: string, public readonly fsPath: string, public readonly query = '') {}

  public get path(): string {
    return this.fsPath;
  }

  public static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }

  public static parse(value: string): Uri {
    const url = new URL(value);
    return new Uri(url.protocol.slice(0, -1), value.slice(url.protocol.length));
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...segments].join('/'));
  }

  public toString(): string {
    return `${this.scheme}://${this.fsPath}${this.query ? `?${this.query}` : ''}`;
  }
}

export const workspace = {
  workspaceFolders: undefined as Array<{ name: string; uri: Uri; index: number }> | undefined,
  workspaceFile: undefined as Uri | undefined,
  isTrusted: true,
  get fs(): unknown {
    return {
      readFile: async () => new Uint8Array(),
      stat: async () => ({}),
      readDirectory: async () => []
    };
  },
  textDocuments: [] as unknown[],
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue: T) => defaultValue
  }),
  asRelativePath: (uri: Uri | string) => {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    const folder = workspace.workspaceFolders?.find((candidate) => fsPath.startsWith(`${candidate.uri.fsPath}/`));
    return folder ? fsPath.slice(folder.uri.fsPath.length + 1) : fsPath;
  }
};

export class LanguageModelToolResult {
  public constructor(public readonly content: unknown[]) {}
}


export const lm = {
  tools: [] as unknown[],
  selectChatModels: async (_selector?: unknown): Promise<unknown[]> => [],
  onDidChangeChatModels: (_listener: unknown) => new Disposable(),
  invokeTool: async () => ({ content: [] })
};

export const env = {
  shell: '/bin/sh',
  clipboard: { writeText: async (_text: string) => undefined },
  openExternal: async (_uri: Uri) => true
};

export class Position {
  public constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public constructor(public readonly start: Position, public readonly end: Position) {}
}

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

/** Proposals VS Code enabled for the extension; tests set this to simulate Insiders/allowlisting. */
export const testState = { enabledApiProposals: [] as string[] };

export const extensions = {
  getExtension: (_id: string) => ({ packageJSON: { enabledApiProposals: testState.enabledApiProposals } })
};

export const version = '1.139.0';
