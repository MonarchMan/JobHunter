import type {
  InitializationResult,
  SystemInitializer,
} from '@jobhunter/common/operations/initialization-service';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import {
  seedSourceCatalog,
  type SourceCatalogSeedRecord,
} from '@jobhunter/recruitment/persistence/source-catalog-seed';

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
    // 1、创建数据目录；2、打开并迁移数据库；3、写入来源目录；4、返回计数并关闭连接。
    const dataRoot = path.resolve(input.dataRoot);
    await mkdir(dataRoot, { recursive: true });

    const database = openSqliteDatabase({ dataRoot });
    try {
      seedSourceCatalog(database.client, this.#catalog);
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
