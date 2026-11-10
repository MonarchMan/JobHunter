import { expect, it } from 'vitest';
import { classifyTaskError } from '../src/tasks/scheduling/retry-policy.js';
import { ModelRequestPersistenceError } from '../src/agent/errors.js';
import { threadStorageFailure } from '../src/tasks/execution/thread-storage-error.js';
import { sqliteMaintenanceMessage } from '../src/persistence/maintenance-gate.js';

it.each(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED', 'SQLITE_LOCKED_SHAREDCACHE'])(
  'retries direct and wrapped %s without exposing database details',
  (code) => {
    const databaseError = Object.assign(new Error('private SQL'), { code });
    for (const error of [
      databaseError,
      new Error('repository failure', { cause: databaseError }),
    ]) {
      const classified = classifyTaskError(error);
      expect(classified).toMatchObject({ category: 'io_temporary', retryable: true, cause: error });
      expect(classified.safeSummary).not.toContain('private SQL');
    }
  },
);

it('terminates cyclic cause chains and does not retry unrelated SQLite errors', () => {
  const error = Object.assign(new Error('corrupt'), { code: 'SQLITE_CORRUPT' });
  error.cause = error;
  expect(classifyTaskError(error).category).toBe('permanent');
});

it.each(['SQLITE_BUSY', 'SQLITE_LOCKED', sqliteMaintenanceMessage])(
  'retains ledger diagnostics without reclassifying %s as recoverable storage failure',
  (code) => {
    const cause = Object.assign(new Error(code), { code });
    const ledgerError = new ModelRequestPersistenceError('request-1', 'completed', { cause });
    for (const error of [ledgerError, new Error('wrapped', { cause: ledgerError })]) {
      expect(classifyTaskError(error)).toMatchObject({
        category: 'invalid_config',
        retryable: false,
        cause: error,
      });
      expect(threadStorageFailure(error)).toBeUndefined();
    }
    expect(ledgerError.cause).toBe(cause);
    expect(threadStorageFailure(cause)).toBe(code);
  },
);
