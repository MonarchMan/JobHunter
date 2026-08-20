import type { RepositorySet, UnitOfWork } from '@jobhunter/application';
import type Database from 'better-sqlite3';
import { SqliteJobRepository } from './repositories/job-repository.js';
import { SqliteSyncRepository } from './repositories/sync-repository.js';
import { SqliteTaskRepository } from './repositories/task-repository.js';

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

  public run<TResult>(work: (repositories: RepositorySet) => TResult): TResult {
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
