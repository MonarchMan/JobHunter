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

/** 负责 SQLite 在线备份、校验和恢复前置操作。 */
export class SqliteBackupOperations implements BackupOperationsPort {
  readonly #dataRoot: string;

  public constructor(dataRoot: string) {
    this.#dataRoot = dataRoot;
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public list(root: string): ReturnType<BackupOperationsPort['list']> {
    return listBackups(root);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public verify(directory: string): ReturnType<BackupOperationsPort['verify']> {
    return verifyBackup(directory);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public planRestore(
    backupDirectory: string,
    targetDataRoot: string,
  ): ReturnType<BackupOperationsPort['planRestore']> {
    return planRestoreBackup(backupDirectory, targetDataRoot);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public restore(
    backupDirectory: string,
    targetDataRoot: string,
    confirmationToken: string,
  ): ReturnType<BackupOperationsPort['restore']> {
    return restoreBackup(backupDirectory, targetDataRoot, confirmationToken);
  }
}
