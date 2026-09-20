import type { PlatformRepository } from '@jobhunter/application';
import { platformDefinitions, type PlatformProviderKey } from '@jobhunter/platform-core';
import {
  contentHash,
  decideJobMerge,
  parseId,
  parseNormalizedJob,
  SystemIdGenerator,
  utcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { SqliteJobRepository } from './repositories/job-repository.js';

/** 平台事务仓储；不创建伪官网公司、逻辑渠道或同步运行。 */
export class SqlitePlatformRepository implements PlatformRepository {
  readonly #ids = new SystemIdGenerator();
  public constructor(
    private readonly client: Database.Database,
    private readonly providerKey: PlatformProviderKey = 'boss',
  ) {}

  /** 页面状态只含代次和结果，不保存或返回认证数据。 */
  public snapshot(): { generation: number; status: string } | null {
    return (
      (this.client
        .prepare('SELECT generation,status FROM platform_connections WHERE provider_key=?')
        .get(this.providerKey) as { generation: number; status: string } | undefined) ?? null
    );
  }

  /** 连接代次持久化，但认证凭据从不进入数据库。 */
  public reset(now: number): number {
    this.client
      .prepare(
        `INSERT INTO platform_connections(provider_key,generation,status,updated_at) VALUES (?,1,'disconnected',?) ON CONFLICT(provider_key) DO UPDATE SET generation=generation+1,status='disconnected',updated_at=excluded.updated_at`,
      )
      .run(this.providerKey, now);
    const generation = this.generation();
    if (generation === null) throw new Error('Platform generation unavailable.');
    return generation;
  }

  /** 获取当前代次，未连接时返回空。 */
  public generation(): number | null {
    return (
      (
        this.client
          .prepare('SELECT generation FROM platform_connections WHERE provider_key=?')
          .get(this.providerKey) as { generation: number } | undefined
      )?.generation ?? null
    );
  }

  /** 旧代次不能覆盖新连接状态。 */
  public setStatus(
    generation: number,
    status: Parameters<PlatformRepository['setStatus']>[1],
    now: number,
  ): void {
    this.client
      .prepare(
        'UPDATE platform_connections SET status=?,updated_at=? WHERE provider_key=? AND generation=?',
      )
      .run(status, now, this.providerKey, generation);
  }

  /** 网络完成后原子保存公司身份、正式职位、修订和本次任务观察。 */
  public save(
    detail: Parameters<PlatformRepository['save']>[0],
    generation: number,
    taskId: string,
    now: number,
  ): string {
    return this.client
      .transaction(() => {
        const { sourceId, baseUrl } = platformDefinitions[this.providerKey];
        // 1、取消、租约过期、连接替换均拒绝迟到提交。
        const task = this.client
          .prepare(
            'SELECT task_type,status,cancel_requested_at,lease_expires_at FROM tasks WHERE id=?',
          )
          .get(taskId) as
          | {
              task_type: string;
              status: string;
              cancel_requested_at: number | null;
              lease_expires_at: number | null;
            }
          | undefined;
        if (
          this.generation() !== generation ||
          task?.status !== 'running' ||
          task.task_type !== `platform.${this.providerKey}` ||
          task.cancel_requested_at !== null ||
          (task.lease_expires_at ?? 0) <= now
        )
          throw new Error('Platform task is no longer writable.');
        // 2、来源跨公司，不加入官网目录与计划；公司身份严格按平台 ID 隔离。
        this.client
          .prepare(
            `INSERT INTO job_sources(id,company_id,channel_id,slug,adapter_key,coverage_role,base_url,config_json,sync_policy_version,sync_policy_json,enabled,support_status,health_status,created_at,updated_at,source_kind,provider_key) VALUES (?,NULL,NULL,?,?,NULL,?,'{}','platform-v1','{}',0,'experimental','unknown',?,?,'platform',?) ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            sourceId,
            `${this.providerKey}-recommend`,
            `${this.providerKey}.recommend`,
            baseUrl,
            now,
            now,
            this.providerKey,
          );
        let companyId = (
          this.client
            .prepare(
              'SELECT company_id FROM company_external_identities WHERE provider_key=? AND external_company_id=?',
            )
            .get(this.providerKey, detail.externalCompanyId) as { company_id: string } | undefined
        )?.company_id;
        if (!companyId) {
          companyId = this.#ids.generate();
          this.client
            .prepare(
              "INSERT INTO companies(id,slug,name,aliases_json,enabled,created_at,updated_at) VALUES (?,?,?,'[]',1,?,?)",
            )
            .run(
              companyId,
              `${this.providerKey}-${contentHash(detail.externalCompanyId)}`,
              detail.company,
              now,
              now,
            );
          this.client
            .prepare(
              'INSERT INTO company_external_identities(provider_key,external_company_id,company_id) VALUES (?,?,?)',
            )
            .run(this.providerKey, detail.externalCompanyId, companyId);
        }
        // 3、共用现有领域归一化与合并规则，不猜测招聘类型或发布日期。
        const normalized = parseNormalizedJob({
          companyId,
          sourceId,
          externalJobId: detail.externalJobId,
          title: detail.title,
          department: null,
          jobFamily: null,
          jobSubfamily: null,
          locations: [detail.city],
          employmentType: null,
          recruitmentCategory: null,
          experienceText: detail.experience || null,
          educationText: detail.education || null,
          description: detail.description,
          detailUrl: detail.sourceUrl,
          applyUrl: detail.sourceUrl,
          publishedAt: null,
        });
        const jobs = new SqliteJobRepository(this.client);
        const current = jobs.findCurrent({
          sourceId: parseId(sourceId, 'JobSource'),
          externalJobId: detail.externalJobId,
        });
        const decision = decideJobMerge(current, normalized);
        const jobId = current?.jobId ?? parseId(this.#ids.generate(), 'Job');
        if (decision.type === 'unchanged' && current)
          jobs.recordObservation({
            jobId,
            syncRunId: null,
            platformTaskId: taskId,
            jobRevisionId: current.revisionId,
            observedAt: utcInstant(now),
          });
        else if (decision.type !== 'unchanged')
          jobs.persistMutation({
            decision,
            jobId,
            revisionId: this.#ids.generate(),
            statusEventId: this.#ids.generate(),
            sourcePayloadHash: contentHash(normalized),
            sourceUrl: detail.sourceUrl,
            normalizerVersion: `${this.providerKey}-v1`,
            syncRunId: null,
            platformTaskId: taskId,
            observedAt: utcInstant(now),
          });
        this.client
          .prepare('UPDATE jobs SET last_seen_at=max(last_seen_at,?) WHERE id=?')
          .run(now, jobId);
        this.setStatus(generation, 'available', now);
        return jobId;
      })
      .immediate();
  }
}
