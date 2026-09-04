import type { JobRepository } from './jobs.js';
import type { SyncRepository } from '../sync/model.js';
import type { TaskQueue } from '../tasks/model.js';

/** 应用层数据结构或端口契约。 */
export interface RepositorySet {
  readonly jobs: JobRepository;
  readonly sync: SyncRepository;
  readonly tasks: TaskQueue;
}

/** 应用层数据结构或端口契约。 */
export interface UnitOfWork {
  run<TResult>(work: (repositories: RepositorySet) => TResult): TResult;
}
