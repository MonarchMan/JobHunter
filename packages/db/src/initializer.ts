import type { InitializationResult, SystemInitializer } from '@jobhunter/application';
import { contentHash, parseId, utcInstant } from '@jobhunter/domain';
import { matchRulesetV1 } from '@jobhunter/matching';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from './connection.js';
import { seedSourceCatalog, type SourceCatalogSeedRecord } from './seeding/source-catalog.js';
import { SqliteMatchingRepository } from './repositories/matching-repository.js';

/** 系统首次初始化时写入的默认匹配规则集 ID。 */
export const defaultMatchRulesetId = parseId(
  '018f0000-0000-7000-8000-000000000301',
  'MatchRuleset',
);

/** 创建数据目录、配置文件、数据库迁移和默认种子数据。 */
export class SqliteSystemInitializer implements SystemInitializer {
  readonly #catalog: readonly SourceCatalogSeedRecord[];

  public constructor(catalog: readonly SourceCatalogSeedRecord[]) {
    this.#catalog = catalog;
  }

  /** 幂等初始化本地运行环境并返回诊断摘要。 */
  public async initialize(
    input: Parameters<SystemInitializer['initialize']>[0],
  ): Promise<InitializationResult> {
    // 1、创建目录和配置文件；2、打开并迁移数据库；3、写入来源目录与匹配规则；4、返回计数并关闭连接。
    const dataRoot = path.resolve(input.dataRoot);
    const configPath = path.resolve(input.configPath);
    await mkdir(dataRoot, { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    let configCreated = false;
    try {
      await writeFile(configPath, `${JSON.stringify(input.defaultConfig, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      configCreated = true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const handle = await open(configPath, 'r');
      await handle.close();
    }

    const database = openSqliteDatabase({ dataRoot });
    try {
      seedSourceCatalog(database.client, this.#catalog);
      new SqliteMatchingRepository(database.client).upsertRuleset({
        id: defaultMatchRulesetId,
        version: matchRulesetV1.version,
        definition: matchRulesetV1,
        definitionHash: contentHash(matchRulesetV1),
        active: true,
        createdAt: utcInstant(Date.now()),
      });
      return {
        dataRoot,
        databasePath: database.databasePath,
        configPath,
        configCreated,
        companies: Number(database.client.prepare('SELECT count(*) FROM companies').pluck().get()),
        sources: Number(database.client.prepare('SELECT count(*) FROM job_sources').pluck().get()),
      };
    } finally {
      database.close();
    }
  }
}
