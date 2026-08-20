import type Database from 'better-sqlite3';
import { PersistenceError } from './errors.js';

interface IntegrityRow {
  readonly integrity_check: string;
}

interface ForeignKeyViolation {
  readonly table: string;
  readonly rowid: number;
  readonly parent: string;
  readonly fkid: number;
}

export function assertSqliteCapabilities(client: Database.Database): void {
  try {
    client.exec('CREATE VIRTUAL TABLE temp.__jobhunter_fts_probe USING fts5(value)');
    client.exec('DROP TABLE temp.__jobhunter_fts_probe');
    const jsonResult = client.prepare('SELECT json_valid(\'{"ok":true}\') AS valid').get() as {
      valid: number;
    };
    if (jsonResult.valid !== 1) throw new Error('JSON functions returned an unexpected result.');
  } catch (error) {
    throw new PersistenceError(
      'DATABASE_CAPABILITY_MISSING',
      'SQLite must provide FTS5 and JSON functions.',
      error,
    );
  }
}

export function assertDatabaseIntegrity(client: Database.Database): void {
  const integrityRows = client.prepare('PRAGMA integrity_check').all() as IntegrityRow[];
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new PersistenceError(
      'DATABASE_INTEGRITY_ERROR',
      'SQLite integrity_check did not return ok.',
    );
  }

  const foreignKeyViolations = client
    .prepare('PRAGMA foreign_key_check')
    .all() as ForeignKeyViolation[];
  if (foreignKeyViolations.length > 0) {
    throw new PersistenceError(
      'DATABASE_INTEGRITY_ERROR',
      `SQLite foreign_key_check found ${String(foreignKeyViolations.length)} violation(s).`,
    );
  }
}
