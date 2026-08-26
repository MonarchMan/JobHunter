import { canonicalJson, type UtcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PersistenceError } from './errors.js';

export interface SettingDefinition<TValue> {
  readonly key: string;
  readonly schemaVersion: string;
  readonly schema: z.ZodType<TValue>;
}

export class SettingsRegistry {
  readonly #definitions: ReadonlyMap<string, SettingDefinition<unknown>>;

  public constructor(definitions: readonly SettingDefinition<unknown>[]) {
    const entries = definitions.map((definition) => [definition.key, definition] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new PersistenceError(
        'SETTING_NOT_ALLOWED',
        'Setting registry contains duplicate keys.',
      );
    }
    this.#definitions = new Map(entries);
  }

  public parse(
    key: string,
    value: unknown,
  ): { readonly schemaVersion: string; readonly value: unknown } {
    const definition = this.#definitions.get(key);
    if (!definition) {
      throw new PersistenceError('SETTING_NOT_ALLOWED', `Setting key is not allowlisted: ${key}`);
    }
    return { schemaVersion: definition.schemaVersion, value: definition.schema.parse(value) };
  }

  public definition(key: string): SettingDefinition<unknown> | undefined {
    return this.#definitions.get(key);
  }
}

export const defaultSettingsRegistry = new SettingsRegistry([
  {
    key: 'ui.jobList',
    schemaVersion: '1',
    schema: z
      .object({
        pageSize: z.number().int().min(10).max(200),
        sort: z.enum(['updated_desc', 'published_desc', 'score_desc']),
      })
      .strict(),
  },
  {
    key: 'retention.policy',
    schemaVersion: '1',
    schema: z
      .object({
        observationsDays: z.number().int().min(30).max(3_650),
        rawArtifactsDays: z.number().int().min(7).max(3_650),
      })
      .strict(),
  },
  {
    key: 'matching.jobUnderstanding',
    schemaVersion: '1',
    schema: z.object({ enabled: z.boolean() }).strict(),
  },
]);

interface SettingRow {
  readonly value_json: string;
  readonly schema_version: string;
}

export class SqliteSettingsStore {
  readonly #client: Database.Database;
  readonly #registry: SettingsRegistry;

  public constructor(client: Database.Database, registry = defaultSettingsRegistry) {
    this.#client = client;
    this.#registry = registry;
  }

  public set(key: string, value: unknown, updatedAt: UtcInstant): void {
    const parsed = this.#registry.parse(key, value);
    this.#client
      .prepare(
        `INSERT INTO application_settings (key, value_json, schema_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at`,
      )
      .run(key, canonicalJson(parsed.value), parsed.schemaVersion, updatedAt);
  }

  public get(key: string): unknown {
    const definition = this.#registry.definition(key);
    if (!definition) {
      throw new PersistenceError('SETTING_NOT_ALLOWED', `Setting key is not allowlisted: ${key}`);
    }
    const row = this.#client
      .prepare('SELECT value_json, schema_version FROM application_settings WHERE key = ?')
      .get(key) as SettingRow | undefined;
    if (!row) return null;
    if (row.schema_version !== definition.schemaVersion) {
      throw new PersistenceError(
        'SETTING_NOT_ALLOWED',
        `Unsupported stored schema for setting: ${key}`,
      );
    }
    return definition.schema.parse(JSON.parse(row.value_json) as unknown);
  }
}
