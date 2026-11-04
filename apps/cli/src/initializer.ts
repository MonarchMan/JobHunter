import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import type {
  InitializationResult,
  SystemInitializer,
} from '@jobhunter/common/operations/initialization-service';
import { contentHash, utcInstant } from '@jobhunter/common/domain';
import { matchRulesetV4, defaultMatchRulesetId } from '@jobhunter/matching';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import {
  seedSourceCatalog,
  type SourceCatalogSeedRecord,
} from '@jobhunter/recruitment/persistence/source-catalog-seed';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';

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
      new SqliteMatchingRepository(
        database.client,
        new SqliteMatchingJobReader(database.client),
        new SqliteProfileIdentityReader(database.client),
        new SqliteAgentRunStore(database.client),
      ).upsertRuleset({
        id: defaultMatchRulesetId,
        version: matchRulesetV4.version,
        definition: matchRulesetV4,
        definitionHash: contentHash(matchRulesetV4),
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
