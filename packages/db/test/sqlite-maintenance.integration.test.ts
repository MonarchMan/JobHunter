import { readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { utcInstant } from '@jobhunter/domain';
import { SqliteMaintenanceService } from '@jobhunter/application';
import {
  openSqliteDatabase,
  SqliteMaintenanceRepository,
  SqliteTaskRepository,
  isSqliteMaintenanceActive,
  isSqliteMaintenanceError,
} from '../src/index.js';

describe('SQLite automatic maintenance infrastructure', () => {
  it('releases write protection and records failure if backup creation fails', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-backup-failure-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    const maintenance = new SqliteMaintenanceRepository(database.databasePath);
    try {
      // 1、测试目录内用普通文件模拟备份目录不可创建，不触碰真实备份。
      await writeFile(path.join(root.path, 'backups'), 'blocked');
      await expect(maintenance.maintain('vacuum', Date.now())).rejects.toThrow('failed:backup');
      expect(isSqliteMaintenanceActive(database.client)).toBe(false);
      expect(
        database.client
          .prepare("SELECT status FROM tasks WHERE task_type='maintenance.sqlite'")
          .pluck()
          .get(),
      ).toBe('failed');
      expect(database.client.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      maintenance.close();
      database.close();
      await root.cleanup();
    }
  });

  it('postpones for an upcoming schedule and for an active WAL reader', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-reader-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    const reader = openSqliteDatabase({ dataRoot: root.path });
    const maintenance = new SqliteMaintenanceRepository(database.databasePath);
    try {
      const now = Date.now();
      database.client
        .prepare(
          `INSERT INTO schedules(id,schedule_key,task_type,payload_json,
        cron_expression,timezone,enabled,next_run_at,created_at,updated_at)
        VALUES('soon','soon','test','{}','* * * * *','UTC',1,?,0,0)`,
        )
        .run(now + 30_000);
      expect(await maintenance.maintain('truncate', now)).toBe('work_pending');
      database.client.exec('DELETE FROM schedules');
      reader.client.exec('BEGIN');
      reader.client.prepare('SELECT count(*) FROM tasks').get();
      expect(await maintenance.maintain('truncate', now)).toBe('checkpoint_busy');
      expect(isSqliteMaintenanceActive(database.client)).toBe(false);
      reader.client.exec('ROLLBACK');
      expect(await maintenance.maintain('truncate', now)).toBe('succeeded');
    } finally {
      maintenance.close();
      reader.close();
      database.close();
      await root.cleanup();
    }
  });

  it('protects a second connection, pauses claims and resumes after releasing the marker', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-gate-');
    const owner = openSqliteDatabase({ dataRoot: root.path });
    const other = openSqliteDatabase({ dataRoot: root.path });
    try {
      owner.client
        .prepare('UPDATE database_maintenance SET owner_pid = ? WHERE id = 1')
        .run(process.pid);
      expect(isSqliteMaintenanceActive(other.client)).toBe(true);
      try {
        other.client
          .prepare(
            "INSERT INTO companies(id,slug,name,enabled,created_at,updated_at) VALUES('test','test','test',1,0,0)",
          )
          .run();
        throw new Error('Write unexpectedly succeeded');
      } catch (error) {
        expect(isSqliteMaintenanceError(error)).toBe(true);
      }
      expect(other.client.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(0);
      expect(
        new SqliteTaskRepository(other.client).claim({
          taskType: 'source.sync',
          workerId: 'test',
          now: utcInstant(Date.now()),
          leaseDurationMsFor: () => 60_000,
        }),
      ).toBeNull();
      owner.client.exec('UPDATE database_maintenance SET owner_pid = NULL WHERE id = 1');
      other.client
        .prepare(
          "INSERT INTO companies(id,slug,name,enabled,created_at,updated_at) VALUES('test','test','test',1,0,0)",
        )
        .run();
    } finally {
      other.close();
      owner.close();
      await root.cleanup();
    }
  });

  it('skips pending work and creates no maintenance task', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-busy-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    const maintenance = new SqliteMaintenanceRepository(database.databasePath);
    try {
      database.client.exec(`INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,
        max_attempts,available_at,created_at) VALUES('pending','test','{}','pending','pending',1,0,0)`);
      expect(await maintenance.maintain('vacuum', Date.now())).toBe('work_pending');
      expect(
        database.client
          .prepare("SELECT count(*) FROM tasks WHERE task_type='maintenance.sqlite'")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      maintenance.close();
      database.close();
      await root.cleanup();
    }
  });

  it('reclaims space, keeps data, and rotates only verified automatic backups', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-vacuum-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    const maintenance = new SqliteMaintenanceRepository(database.databasePath);
    try {
      // 1、构造真实空闲页及保留数据；测试缩小阈值，生产默认仍为 64 MiB。
      database.client.exec('CREATE TABLE maintenance_fixture(id INTEGER PRIMARY KEY, body BLOB)');
      const insert = database.client.prepare(
        'INSERT INTO maintenance_fixture(body) VALUES(zeroblob(8192))',
      );
      database.client.transaction(() => {
        for (let i = 0; i < 200; i++) insert.run();
      })();
      database.client.exec('DELETE FROM maintenance_fixture WHERE id > 1');
      database.client.pragma('wal_checkpoint(TRUNCATE)');
      const before = maintenance.inspect();
      expect(before.freeBytes).toBeGreaterThan(0);
      expect(await maintenance.maintain('vacuum', Date.now())).toBe('succeeded');
      expect(maintenance.inspect().freeBytes).toBe(0);
      expect(maintenance.inspect().databaseBytes).toBeLessThan(before.databaseBytes);
      const backups = path.join(root.path, 'backups', 'sqlite-maintenance');
      await writeFile(path.join(backups, 'manual.sqlite'), 'manual');
      await maintenance.maintain('vacuum', Date.now());
      await maintenance.maintain('vacuum', Date.now());
      expect((await readdir(backups)).filter((name) => name.endsWith('.verified'))).toHaveLength(2);
      expect(await readFile(path.join(backups, 'manual.sqlite'), 'utf8')).toBe('manual');
      expect(
        database.client.prepare('SELECT length(body) FROM maintenance_fixture').pluck().get(),
      ).toBe(8192);
      expect(database.client.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(isSqliteMaintenanceActive(database.client)).toBe(false);
    } finally {
      maintenance.close();
      database.close();
      await root.cleanup();
    }
  });

  it('coalesces overdue checks and releases a dead process marker', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-restart-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    const maintenance = new SqliteMaintenanceRepository(database.databasePath);
    try {
      database.client.exec('UPDATE database_maintenance SET owner_pid = 2147483647 WHERE id = 1');
      expect(isSqliteMaintenanceActive(database.client)).toBe(false);
      const service = new SqliteMaintenanceService(maintenance);
      expect(await service.check()).not.toBeNull();
      expect(await service.check()).toBeNull();
      expect(
        database.client.prepare('SELECT owner_pid FROM database_maintenance').pluck().get(),
      ).toBeNull();
      expect(
        database.client
          .prepare("SELECT count(*) FROM tasks WHERE task_type='maintenance.sqlite'")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      maintenance.close();
      database.close();
      await root.cleanup();
    }
  });
});
