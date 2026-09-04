/** 应用层数据结构或端口契约。 */
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

/** 应用层数据结构或端口契约。 */
export interface SystemInitializer {
  initialize(input: {
    readonly dataRoot: string;
    readonly configPath: string;
    readonly defaultConfig: Readonly<Record<string, unknown>>;
  }): Promise<InitializationResult>;
}

/** 编排首次运行所需的目录、配置和数据库初始化。 */
export class InitializationService {
  readonly #initializer: SystemInitializer;

  public constructor(initializer: SystemInitializer) {
    this.#initializer = initializer;
  }

  /** 执行初始化并返回结果。 */
  public initialize(
    input: Parameters<SystemInitializer['initialize']>[0],
  ): Promise<InitializationResult> {
    return this.#initializer.initialize(input);
  }
}
