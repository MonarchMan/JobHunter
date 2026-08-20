import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { OfflineDoctorCheck } from '@jobhunter/application';
import Database from 'better-sqlite3';
import { assertDatabaseIntegrity, assertSqliteCapabilities } from './health.js';

interface TableRow {
  readonly name: string;
}

const requiredTables = [
  'companies',
  'job_sources',
  'jobs',
  'job_revisions',
  'candidate_profiles',
  'profile_versions',
  'tasks',
  'agent_runs',
  'match_results',
  'operation_audit_events',
] as const;

export function sqliteDoctorCheck(client: Database.Database): OfflineDoctorCheck {
  return {
    key: 'database.sqlite',
    severity: 'required',
    run: () => {
      assertSqliteCapabilities(client);
      assertDatabaseIntegrity(client);
      const rows = client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as TableRow[];
      const present = new Set(rows.map((row) => row.name));
      const missingTables = requiredTables.filter((name) => !present.has(name));
      const userVersion = client.pragma('user_version', { simple: true });
      return {
        status: missingTables.length === 0 ? 'healthy' : 'failed',
        summary:
          missingTables.length === 0
            ? 'SQLite、FTS5、JSON、完整性和 Schema 检查通过。'
            : 'SQLite Schema 不完整。',
        recommendation: missingTables.length === 0 ? null : '运行数据库迁移后重新检查。',
        details: { userVersion, missingTables },
      };
    },
  };
}

export function sqliteFileDoctorCheck(dataRoot: string): OfflineDoctorCheck {
  const databasePath = join(resolve(dataRoot), 'jobhunter.sqlite');
  return {
    key: 'database.sqlite',
    severity: 'required',
    run: () => {
      if (!existsSync(databasePath)) {
        return {
          status: 'failed',
          summary: '数据库尚未初始化。',
          recommendation: '运行 jh init 创建数据库和迁移。',
          details: { databasePath },
        };
      }
      const client = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        return sqliteDoctorCheck(client).run();
      } finally {
        client.close();
      }
    },
  };
}

interface CountRow {
  readonly count: number;
}

function count(client: Database.Database, sql: string): number {
  return (client.prepare(sql).get() as CountRow).count;
}

export function readLocalHealthSnapshot(
  client: Database.Database,
  dataRoot: string,
): {
  readonly sources: {
    readonly enabled: number;
    readonly degraded: number;
    readonly unhealthy: number;
  };
  readonly tasks: { readonly pending: number; readonly running: number; readonly failed: number };
  readonly files: { readonly referenced: number; readonly missing: number };
} {
  const root = resolve(dataRoot);
  const artifacts = client
    .prepare('SELECT relative_path FROM file_artifacts WHERE deleted_at IS NULL')
    .all() as { readonly relative_path: string }[];
  const missing = artifacts.filter((artifact) => {
    const path = resolve(root, artifact.relative_path);
    const relation = relative(root, path);
    const insideRoot = relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
    return !insideRoot || !existsSync(path);
  }).length;
  return {
    sources: {
      enabled: count(client, 'SELECT count(*) AS count FROM job_sources WHERE enabled = 1'),
      degraded: count(
        client,
        "SELECT count(*) AS count FROM job_sources WHERE enabled = 1 AND health_status = 'degraded'",
      ),
      unhealthy: count(
        client,
        "SELECT count(*) AS count FROM job_sources WHERE enabled = 1 AND health_status = 'unhealthy'",
      ),
    },
    tasks: {
      pending: count(client, "SELECT count(*) AS count FROM tasks WHERE status = 'pending'"),
      running: count(client, "SELECT count(*) AS count FROM tasks WHERE status = 'running'"),
      failed: count(client, "SELECT count(*) AS count FROM tasks WHERE status = 'failed'"),
    },
    files: { referenced: artifacts.length, missing },
  };
}
