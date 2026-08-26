export interface InitializationResult {
  readonly dataRoot: string;
  readonly databasePath: string;
  readonly configPath: string;
  readonly configCreated: boolean;
  readonly companies: number;
  readonly sources: number;
  readonly bootstrap?: {
    readonly defaultResumeTaskId: string | null;
    readonly sourceSyncTaskIds: readonly string[];
    readonly schedules: number;
  };
}

export interface SystemInitializer {
  initialize(input: {
    readonly dataRoot: string;
    readonly configPath: string;
    readonly defaultConfig: Readonly<Record<string, unknown>>;
  }): Promise<InitializationResult>;
}

export class InitializationService {
  readonly #initializer: SystemInitializer;

  public constructor(initializer: SystemInitializer) {
    this.#initializer = initializer;
  }

  public initialize(
    input: Parameters<SystemInitializer['initialize']>[0],
  ): Promise<InitializationResult> {
    return this.#initializer.initialize(input);
  }
}
