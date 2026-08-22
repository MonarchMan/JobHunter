import type { BackupOperationsPort } from '@jobhunter/application';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  createBackup,
  listBackups,
  planRestoreBackup,
  restoreBackup,
  verifyBackup,
} from './backup.js';
import { openSqliteDatabase } from './connection.js';

export class SqliteBackupOperations implements BackupOperationsPort {
  readonly #dataRoot: string;

  public constructor(dataRoot: string) {
    this.#dataRoot = dataRoot;
  }

  public async create(destination: string): ReturnType<BackupOperationsPort['create']> {
    if (!existsSync(path.join(this.#dataRoot, 'jobhunter.sqlite'))) {
      throw new TypeError('Data root is not initialized.');
    }
    const target = path.resolve(destination);
    const relation = path.relative(path.resolve(this.#dataRoot), target);
    if (!relation || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
      throw new TypeError('Backup destination must be outside the data root.');
    }
    const database = openSqliteDatabase({ dataRoot: this.#dataRoot });
    try {
      return await createBackup(database, target);
    } finally {
      database.close();
    }
  }

  public list(root: string): ReturnType<BackupOperationsPort['list']> {
    return listBackups(root);
  }

  public verify(directory: string): ReturnType<BackupOperationsPort['verify']> {
    return verifyBackup(directory);
  }

  public planRestore(
    backupDirectory: string,
    targetDataRoot: string,
  ): ReturnType<BackupOperationsPort['planRestore']> {
    return planRestoreBackup(backupDirectory, targetDataRoot);
  }

  public restore(
    backupDirectory: string,
    targetDataRoot: string,
    confirmationToken: string,
  ): ReturnType<BackupOperationsPort['restore']> {
    return restoreBackup(backupDirectory, targetDataRoot, confirmationToken);
  }
}
