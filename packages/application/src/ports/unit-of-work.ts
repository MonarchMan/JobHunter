import type { JobRepository } from './jobs.js';
import type { SyncRepository } from '../sync/model.js';
import type { TaskQueue } from '../tasks/model.js';

export interface RepositorySet {
  readonly jobs: JobRepository;
  readonly sync: SyncRepository;
  readonly tasks: TaskQueue;
}

export interface UnitOfWork {
  run<TResult>(work: (repositories: RepositorySet) => TResult): TResult;
}
