import type { RepositorySet, UnitOfWork } from '@jobhunter/application';
import type Database from 'better-sqlite3';
import { SqliteJobRepository } from './repositories/job-repository.js';
import { SqliteSyncRepository } from './repositories/sync-repository.js';
import { SqliteTaskRepository } from './repositories/task-repository.js';

/** 将多个 SQLite 仓储绑定到同一个同步事务边界。 */
export class SqliteUnitOfWork implements UnitOfWork {
  readonly #transaction: <TResult>(work: () => TResult) => TResult;
  readonly #repositories: RepositorySet;

  public constructor(client: Database.Database) {
    this.#repositories = {
      jobs: new SqliteJobRepository(client),
      sync: new SqliteSyncRepository(client),
      tasks: new SqliteTaskRepository(client),
    };
    this.#transaction = client.transaction((work: () => unknown) => work()) as <TResult>(
      work: () => TResult,
    ) => TResult;
  }

  /** 在事务中执行仓储操作，禁止异步回调跨出事务生命周期。 */
  public run<TResult>(work: (repositories: RepositorySet) => TResult): TResult {
    // 1、开启 SQLite 事务；2、执行同步用例；3、拒绝 Promise；4、提交或回滚。
    return this.#transaction(() => {
      const result = work(this.#repositories);
      if (result instanceof Promise) {
        throw new TypeError(
          'UnitOfWork callbacks must be synchronous and cannot return a Promise.',
        );
      }
      return result;
    });
  }
}
