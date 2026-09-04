import { canonicalJson, type UtcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PersistenceError } from './errors.js';

/** 数据库查询结果对应的行结构。 */
export interface SettingDefinition<TValue> {
  readonly key: string;
  readonly schemaVersion: string;
  readonly schema: z.ZodType<TValue>;
}

/** 注册并解析所有应用设置定义。 */
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public definition(key: string): SettingDefinition<unknown> | undefined {
    return this.#definitions.get(key);
  }
}

/** 系统默认设置注册表。 */
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
  {
    key: 'sources.activeChannel',
    schemaVersion: '1',
    schema: z.object({ channel: z.enum(['intern', 'campus', 'social']) }).strict(),
  },
]);

/** 数据库查询结果对应的行结构。 */
interface SettingRow {
  readonly value_json: string;
  readonly schema_version: string;
}

/** 使用 application_settings 表读写强类型设置。 */
export class SqliteSettingsStore {
  readonly #client: Database.Database;
  readonly #registry: SettingsRegistry;

  public constructor(client: Database.Database, registry = defaultSettingsRegistry) {
    this.#client = client;
    this.#registry = registry;
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public setSourceSyncChannel(
    channel: 'intern' | 'campus' | 'social',
    updatedAt: UtcInstant,
  ): void {
    this.#client.transaction(() => {
      this.set('sources.activeChannel', { channel }, updatedAt);
      this.#client
        .prepare(
          `UPDATE source_channels
           SET enabled = CASE
             WHEN channel = ? AND EXISTS (
               SELECT 1 FROM job_sources source
               WHERE source.channel_id = source_channels.id
                 AND source.support_status = 'supported'
             ) THEN 1 ELSE 0 END,
             updated_at = ?`,
        )
        .run(channel, updatedAt);
      this.#client
        .prepare(
          `UPDATE schedules
           SET enabled = CASE WHEN EXISTS (
             SELECT 1 FROM job_sources source
             JOIN source_channels selected ON selected.id = source.channel_id
             WHERE schedules.schedule_key = 'source.sync:' || source.id
               AND selected.channel = ?
               AND selected.enabled = 1
               AND source.enabled = 1
               AND source.support_status = 'supported'
           ) THEN 1 ELSE 0 END,
           updated_at = ?
           WHERE task_type = 'source.sync'`,
        )
        .run(channel, updatedAt);
      this.#client
        .prepare(
          `UPDATE tasks
           SET status = 'cancelled', error_category = 'cancelled',
               error_summary = 'The selected recruitment channel changed.', finished_at = ?
           WHERE task_type = 'source.sync' AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM job_sources source
               JOIN source_channels previous ON previous.id = source.channel_id
               WHERE source.id = json_extract(tasks.payload_json, '$.sourceId')
                 AND previous.channel != ?
             )`,
        )
        .run(updatedAt, channel);
    })();
  }
}
