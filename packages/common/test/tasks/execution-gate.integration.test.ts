import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { installTaskExecutionGate } from '../../src/persistence/task-execution-gate.js';
import {
  withTaskExecution,
  type TaskExecutionIdentity,
} from '../../src/tasks/contracts/execution-scope.js';

/** 用真实 SQLite 事务验证不同业务表的提交门控，避免只测试 tasks 更新。 */
function fixture(): {
  db: Database.Database;
  write: Database.Statement;
  identity: TaskExecutionIdentity;
} {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, status TEXT, lease_owner TEXT, attempt_count INTEGER,
    lease_expires_at INTEGER, cancel_requested_at INTEGER
  );
  CREATE TABLE business_result (id TEXT PRIMARY KEY, value TEXT);
  INSERT INTO tasks VALUES ('task', 'running', 'first', 1, 100, NULL);
  INSERT INTO business_result VALUES ('result', 'original');`);
  installTaskExecutionGate(db);
  const write = db.prepare("UPDATE business_result SET value = ? WHERE id = 'result'");
  const identity = { taskId: 'task', owner: 'first', attempt: 1, now: () => 50 };
  return { db, write, identity };
}

describe('task execution commit gate', () => {
  it('rejects late business writes after takeover and accepts the new dispatch', () => {
    const { db, write, identity } = fixture();
    try {
      withTaskExecution(identity, () => write.run('first result'));
      db.exec("UPDATE tasks SET lease_owner = 'second', attempt_count = 2");
      expect(() => withTaskExecution(identity, () => write.run('stale result'))).toThrow(
        'JOBHUNTER_TASK_EXECUTION_LOST',
      );
      withTaskExecution({ ...identity, owner: 'second', attempt: 2 }, () =>
        write.run('new result'),
      );
      expect(db.prepare('SELECT value FROM business_result').get()).toEqual({
        value: 'new result',
      });
    } finally {
      db.close();
    }
  });

  it.each(['expiry', 'cancellation', 'completion'])('rejects writes after %s', (reason) => {
    const { db, write, identity } = fixture();
    try {
      if (reason === 'expiry') db.exec('UPDATE tasks SET lease_expires_at = 50');
      if (reason === 'cancellation') db.exec('UPDATE tasks SET cancel_requested_at = 40');
      if (reason === 'completion') db.exec("UPDATE tasks SET status = 'succeeded'");
      expect(() => withTaskExecution(identity, () => write.run('invalid'))).toThrow(
        'JOBHUNTER_TASK_EXECUTION_LOST',
      );
      expect(db.prepare('SELECT value FROM business_result').get()).toEqual({ value: 'original' });
    } finally {
      db.close();
    }
  });

  it('rolls back the whole business transaction when a later write loses execution rights', () => {
    const { db, write, identity } = fixture();
    let now = 50;
    try {
      expect(() => {
        withTaskExecution({ ...identity, now: () => now }, () => {
          db.transaction(() => {
            write.run('must roll back');
            now = 100;
            write.run('expired');
          })();
        });
      }).toThrow('JOBHUNTER_TASK_EXECUTION_LOST');
      expect(db.prepare('SELECT value FROM business_result').get()).toEqual({ value: 'original' });
    } finally {
      db.close();
    }
  });

  it('keeps concurrent async task identities isolated and leaves ordinary writes available', async () => {
    const { db, write, identity } = fixture();
    try {
      await Promise.all([
        withTaskExecution(identity, async () => {
          await Promise.resolve();
          write.run('valid');
        }),
        withTaskExecution({ ...identity, owner: 'stale' }, async () => {
          await Promise.resolve();
          expect(() => write.run('invalid')).toThrow('JOBHUNTER_TASK_EXECUTION_LOST');
        }),
      ]);
      write.run('manual');
      expect(db.prepare('SELECT value FROM business_result').get()).toEqual({ value: 'manual' });
    } finally {
      db.close();
    }
  });
});
