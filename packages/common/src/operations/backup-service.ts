/** 应用层数据结构或端口契约。 */
export interface BackupManifestView {
  readonly formatVersion: number;
  readonly createdAt: string;
  readonly database: { readonly fileName: string; readonly sha256: string };
  readonly artifacts: readonly {
    readonly id: string;
    readonly relativePath: string;
    readonly sha256: string;
    readonly byteSize: number;
  }[];
}

/** 应用层数据结构或端口契约。 */
export interface BackupListView {
  readonly directory: string;
  readonly createdAt: string | null;
  readonly artifactCount: number | null;
  readonly totalArtifactBytes: number | null;
  readonly manifestValid: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface RestorePlanView {
  readonly kind: 'restore';
  readonly backupDirectory: string;
  readonly targetDataRoot: string;
  readonly targets: readonly string[];
  readonly counts: { readonly databaseFiles: 1; readonly artifacts: number };
  readonly bytes: number;
  readonly warnings: readonly string[];
  readonly expiresAt: number;
  readonly confirmationToken: string;
}

/** 应用层数据结构或端口契约。 */
export interface RestoreResultView {
  readonly restoredDataRoot: string;
  readonly previousDataRoot: string | null;
}

/** 应用层数据结构或端口契约。 */
export interface BackupOperationsPort {
  create(destination: string): Promise<BackupManifestView>;
  list(root: string): Promise<readonly BackupListView[]>;
  verify(directory: string): Promise<BackupManifestView>;
  planRestore(backupDirectory: string, targetDataRoot: string): Promise<RestorePlanView>;
  restore(
    backupDirectory: string,
    targetDataRoot: string,
    confirmationToken: string,
  ): Promise<RestoreResultView>;
}

/** Application-level facade keeps CLI commands independent from SQLite backup primitives. */
/** 编排本地数据库备份、验证、列表和恢复。 */
export class BackupService {
  readonly #operations: BackupOperationsPort;

  public constructor(operations: BackupOperationsPort) {
    this.#operations = operations;
  }

  /** 创建并验证一个备份。 */
  public create(destination: string): Promise<BackupManifestView> {
    return this.#operations.create(destination);
  }

  public list(root: string): Promise<readonly BackupListView[]> {
    return this.#operations.list(root);
  }

  /** 执行应用组件对外暴露的操作。 */
  public verify(directory: string): Promise<BackupManifestView> {
    return this.#operations.verify(directory);
  }

  /** 校验恢复计划并执行恢复。 */
  public restore(input: {
    // 1、生成恢复计划；2、校验用户确认；3、执行恢复；4、返回结果。
    readonly backupDirectory: string;
    readonly targetDataRoot: string;
    readonly confirmationToken?: string;
  }): Promise<RestorePlanView | RestoreResultView> {
    return input.confirmationToken
      ? this.#operations.restore(
          input.backupDirectory,
          input.targetDataRoot,
          input.confirmationToken,
        )
      : this.#operations.planRestore(input.backupDirectory, input.targetDataRoot);
  }
}
