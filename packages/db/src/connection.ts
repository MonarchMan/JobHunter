import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { PersistenceError } from './errors.js';
import { assertDatabaseIntegrity, assertSqliteCapabilities } from './health.js';
import { installSqliteMaintenanceGate } from './maintenance-gate.js';

const activeConnections = new Map<string, number>();

/** 注册一个已打开的数据库路径，供并发打开保护和诊断使用。 */
function registerConnection(databasePath: string): void {
  activeConnections.set(databasePath, (activeConnections.get(databasePath) ?? 0) + 1);
}

/** 释放数据库路径的活动连接计数。 */
function unregisterConnection(databasePath: string): void {
  const count = activeConnections.get(databasePath) ?? 0;
  if (count <= 1) activeConnections.delete(databasePath);
  else activeConnections.set(databasePath, count - 1);
}

/** 判断指定数据库是否仍有活动连接。 */
export function hasActiveDatabaseConnection(databasePath: string): boolean {
  return (activeConnections.get(path.resolve(databasePath)) ?? 0) > 0;
}

/** 数据库查询结果对应的行结构。 */
export interface OpenDatabaseOptions {
  readonly dataRoot: string;
  readonly databaseFileName?: string;
  readonly busyTimeoutMs?: number;
  readonly runMigrations?: boolean;
  readonly migrationsFolder?: string;
  /** 恢复等显式验证场景要求完整扫描；普通连接仅在实际迁移后扫描。 */
  readonly checkIntegrity?: boolean;
}

/** 数据库查询结果对应的行结构。 */
export interface SqliteDatabaseHandle {
  readonly client: Database.Database;
  readonly db: BetterSQLite3Database;
  readonly dataRoot: string;
  readonly databasePath: string;
  close(): void;
}

/** 校验并解析数据库路径、迁移目录与锁等待配置。 */
function validateOptions(options: OpenDatabaseOptions): Required<OpenDatabaseOptions> {
  const databaseFileName = options.databaseFileName ?? 'jobhunter.sqlite';
  if (
    path.isAbsolute(databaseFileName) ||
    databaseFileName.includes('/') ||
    databaseFileName.includes('\\') ||
    databaseFileName === '.' ||
    databaseFileName === '..'
  ) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Database file name must be a simple file name.',
    );
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 120_000) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'busyTimeoutMs is outside the supported range.',
    );
  }
  return {
    dataRoot: path.resolve(options.dataRoot),
    databaseFileName,
    busyTimeoutMs,
    runMigrations: options.runMigrations ?? true,
    checkIntegrity: options.checkIntegrity ?? false,
    migrationsFolder: path.resolve(
      /* turbopackIgnore: true */
      options.migrationsFolder ?? path.resolve(import.meta.dirname, '../migrations'),
    ),
  };
}

/** 打开数据库并执行迁移；仅迁移或显式验证时扫描完整性，普通连接保持轻量。 */
export function openSqliteDatabase(options: OpenDatabaseOptions): SqliteDatabaseHandle {
  // 1、解析配置并创建数据目录，打开 SQLite 后设置连接参数并验证能力。
  const resolved = validateOptions(options);
  mkdirSync(resolved.dataRoot, { recursive: true });
  const databasePath = path.join(resolved.dataRoot, resolved.databaseFileName);
  let client: Database.Database | undefined;

  try {
    client = new Database(databasePath);
    client.pragma('journal_mode = WAL');
    client.pragma(`busy_timeout = ${String(resolved.busyTimeoutMs)}`);
    assertSqliteCapabilities(client);

    const db = drizzle(client);
    // 2、读取廉价的连接变更计数，包含只更新数据而不修改 Schema 的迁移。
    const changes = client.prepare<[], { total: number }>('SELECT total_changes() AS total');
    const changesBefore = changes.get()?.total;
    const schemaBefore = client.pragma('schema_version', { simple: true });
    if (resolved.runMigrations) {
      client.pragma('foreign_keys = OFF');
      migrate(db, { migrationsFolder: resolved.migrationsFolder });
    }
    client.pragma('foreign_keys = ON');
    // 3、普通重连不扫描历史数据；新建、实际迁移或显式验证仍完整检查。
    if (
      resolved.checkIntegrity ||
      changes.get()?.total !== changesBefore ||
      client.pragma('schema_version', { simple: true }) !== schemaBefore
    ) {
      assertDatabaseIntegrity(client);
    }
    installSqliteMaintenanceGate(client);
    registerConnection(databasePath);
    let closed = false;

    return {
      client,
      db,
      dataRoot: resolved.dataRoot,
      databasePath,
      close(): void {
        if (closed) return;
        closed = true;
        if (client?.open) client.close();
        unregisterConnection(databasePath);
      },
    };
  } catch (error) {
    if (client?.open) client.close();
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Unable to initialize the SQLite database.',
      error,
    );
  }
}
