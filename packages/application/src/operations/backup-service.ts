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

export interface BackupListView {
  readonly directory: string;
  readonly createdAt: string | null;
  readonly artifactCount: number | null;
  readonly totalArtifactBytes: number | null;
  readonly manifestValid: boolean;
}

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

export interface RestoreResultView {
  readonly restoredDataRoot: string;
  readonly previousDataRoot: string | null;
}

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
export class BackupService {
  readonly #operations: BackupOperationsPort;

  public constructor(operations: BackupOperationsPort) {
    this.#operations = operations;
  }

  public create(destination: string): Promise<BackupManifestView> {
    return this.#operations.create(destination);
  }

  public list(root: string): Promise<readonly BackupListView[]> {
    return this.#operations.list(root);
  }

  public verify(directory: string): Promise<BackupManifestView> {
    return this.#operations.verify(directory);
  }

  public restore(input: {
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
