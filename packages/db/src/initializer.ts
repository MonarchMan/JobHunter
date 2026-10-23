import type { InitializationResult, SystemInitializer } from '@jobhunter/application';
import { contentHash, parseId, utcInstant } from '@jobhunter/domain';
import { matchRulesetV32 } from '@jobhunter/matching';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from './connection.js';
import { seedSourceCatalog, type SourceCatalogSeedRecord } from './seeding/source-catalog.js';
import { SqliteMatchingRepository } from './repositories/matching-repository.js';

/** 系统首次初始化时写入的默认匹配规则集 ID。 */
export const defaultMatchRulesetId = parseId(
  '018f0000-0000-7000-8000-000000000305',
  'MatchRuleset',
);

/** 创建数据目录、数据库迁移和默认种子数据；运行配置统一由环境提供。 */
export class SqliteSystemInitializer implements SystemInitializer {
  readonly #catalog: readonly SourceCatalogSeedRecord[];

  public constructor(catalog: readonly SourceCatalogSeedRecord[]) {
    this.#catalog = catalog;
  }

  /** 幂等初始化本地运行环境并返回诊断摘要。 */
  public async initialize(
    input: Parameters<SystemInitializer['initialize']>[0],
  ): Promise<InitializationResult> {
    // 1、创建数据目录；2、打开并迁移数据库；3、写入来源目录与匹配规则；4、返回计数并关闭连接。
    const dataRoot = path.resolve(input.dataRoot);
    await mkdir(dataRoot, { recursive: true });

    const database = openSqliteDatabase({ dataRoot });
    try {
      seedSourceCatalog(database.client, this.#catalog);
      new SqliteMatchingRepository(database.client).upsertRuleset({
        id: defaultMatchRulesetId,
        version: matchRulesetV32.version,
        definition: matchRulesetV32,
        definitionHash: contentHash(matchRulesetV32),
        active: true,
        createdAt: utcInstant(Date.now()),
      });
      return {
        dataRoot,
        databasePath: database.databasePath,
        companies: Number(database.client.prepare('SELECT count(*) FROM companies').pluck().get()),
        sources: Number(database.client.prepare('SELECT count(*) FROM job_sources').pluck().get()),
      };
    } finally {
      database.close();
    }
  }
}
