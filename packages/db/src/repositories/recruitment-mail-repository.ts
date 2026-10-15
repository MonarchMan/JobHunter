import type Database from 'better-sqlite3';
import { projectApplicationStatus } from '@jobhunter/domain';

/** 数据库中的招聘邮件引用行。 */
export interface MailMessageRefRecord {
  readonly id: string;
  readonly mailboxKey: string;
  readonly providerKey: string;
  readonly externalMessageKey: string;
  readonly threadKeyHash: string | null;
  readonly sourceUrl: string | null;
  readonly receivedAt: number;
  readonly contentVersion: string;
  readonly contentHash: string | null;
  readonly processingStatus: string;
  readonly lastClassifierKind: string | null;
  readonly lastClassifierVersion: string | null;
  readonly lastSeenAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 已确认招聘事件写入申请当前投影所需的结构化输入。 */
export interface AcceptedApplicationEventInput {
  readonly applicationId: string;
  readonly companyId?: string | null;
  readonly jobId?: string | null;
  readonly externalApplicationKeyHash?: string | null;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly mailMessageRefId: string;
  readonly sourceContentHash: string;
  readonly sourceEventNo: number;
  readonly acceptanceKind: 'automatic' | 'user_confirmed';
  readonly classifierKind: 'rules' | 'agent';
  readonly classifierVersion: string;
  readonly agentRunId?: string | null;
  readonly eventType: string;
  readonly effectiveAt: number;
  readonly receivedAt: number;
  readonly confidence: number;
  readonly payloadJson: string;
  readonly eventId: string;
  readonly now: number;
}

/** 招聘邮件最小引用、申请事件和当前投影的 SQLite 仓储。 */
export class SqliteRecruitmentMailRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 幂等登记一封外部邮件；重放页只更新最近观察时间和内容版本。 */
  public upsertMessageRef(input: MailMessageRefRecord): void {
    this.#client
      .prepare(
        `
      INSERT INTO mail_message_refs (
        id, mailbox_key, provider_key, external_message_key, thread_key_hash, source_url,
        received_at, content_version, content_hash, processing_status, last_classifier_kind,
        last_classifier_version, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mailbox_key, external_message_key) DO UPDATE SET
        thread_key_hash = excluded.thread_key_hash,
        source_url = excluded.source_url,
        received_at = excluded.received_at,
        content_version = excluded.content_version,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        input.id,
        input.mailboxKey,
        input.providerKey,
        input.externalMessageKey,
        input.threadKeyHash,
        input.sourceUrl,
        input.receivedAt,
        input.contentVersion,
        input.contentHash,
        input.processingStatus,
        input.lastClassifierKind,
        input.lastClassifierVersion,
        input.lastSeenAt,
        input.createdAt,
        input.updatedAt,
      );
  }

  /** 按内部引用读取邮件状态，正文和分类中间结果不会被返回。 */
  public findMessageRef(id: string): MailMessageRefRecord | null {
    const row = this.#client.prepare('SELECT * FROM mail_message_refs WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? toMessageRef(row) : null;
  }

  /** 原子更新邮件处理结论及分类器版本。 */
  public updateMessageStatus(
    id: string,
    status: string,
    classifierKind: string | null,
    classifierVersion: string | null,
    contentHash: string | null,
    updatedAt: number,
  ): void {
    this.#client
      .prepare(
        `UPDATE mail_message_refs SET processing_status = ?, last_classifier_kind = ?, last_classifier_version = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, classifierKind, classifierVersion, contentHash, updatedAt, id);
  }

  /** 查询申请时间线，供 Web 或 CLI 展示。 */
  public listApplicationEvents(applicationId: string): readonly Record<string, unknown>[] {
    return this.#client
      .prepare(
        'SELECT * FROM application_events WHERE application_id = ? ORDER BY effective_at, sequence_no',
      )
      .all(applicationId) as Record<string, unknown>[];
  }

  /** 检查邮件来源事实是否已经创建过申请事件。 */
  public hasApplicationEvent(
    mailMessageRefId: string,
    sourceContentHash: string,
    sourceEventNo: number,
  ): boolean {
    return Boolean(
      this.#client
        .prepare(
          'SELECT 1 FROM application_events WHERE mail_message_ref_id = ? AND source_content_hash = ? AND source_event_no = ?',
        )
        .get(mailMessageRefId, sourceContentHash, sourceEventNo),
    );
  }

  /** 在一个短事务中幂等追加申请事件，并按有效时间更新当前状态投影。 */
  public appendAcceptedApplicationEvent(input: AcceptedApplicationEventInput): boolean {
    const transaction = this.#client.transaction(() => {
      if (
        this.hasApplicationEvent(
          input.mailMessageRefId,
          input.sourceContentHash,
          input.sourceEventNo,
        )
      ) {
        return false;
      }
      this.#client
        .prepare(
          `INSERT INTO job_applications (
            id, company_id, job_id, external_application_key_hash, company_name, role_title,
            status, status_effective_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'unknown', NULL, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            company_id = COALESCE(excluded.company_id, job_applications.company_id),
            job_id = COALESCE(excluded.job_id, job_applications.job_id),
            external_application_key_hash = COALESCE(excluded.external_application_key_hash, job_applications.external_application_key_hash),
            company_name = excluded.company_name,
            role_title = excluded.role_title,
            updated_at = excluded.updated_at`,
        )
        .run(
          input.applicationId,
          input.companyId ?? null,
          input.jobId ?? null,
          input.externalApplicationKeyHash ?? null,
          input.companyName,
          input.roleTitle,
          input.now,
          input.now,
        );
      const sequence = (
        this.#client
          .prepare(
            'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM application_events WHERE application_id = ?',
          )
          .get(input.applicationId) as { next: number }
      ).next;
      this.#client
        .prepare(
          `INSERT INTO application_events (
            id, application_id, sequence_no, mail_message_ref_id, source_content_hash, source_event_no,
            acceptance_kind, classifier_kind, classifier_version, agent_run_id, event_type,
            effective_at, received_at, confidence, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.eventId,
          input.applicationId,
          sequence,
          input.mailMessageRefId,
          input.sourceContentHash,
          input.sourceEventNo,
          input.acceptanceKind,
          input.classifierKind,
          input.classifierVersion,
          input.agentRunId ?? null,
          input.eventType,
          input.effectiveAt,
          input.receivedAt,
          input.confidence,
          input.payloadJson,
          input.now,
        );
      const nextStatus = projectApplicationStatus(
        input.eventType as Parameters<typeof projectApplicationStatus>[0],
      );
      const current = this.#client
        .prepare('SELECT status_effective_at FROM job_applications WHERE id = ?')
        .get(input.applicationId) as { status_effective_at: number | null };
      if (
        nextStatus &&
        (current.status_effective_at === null || input.effectiveAt >= current.status_effective_at)
      ) {
        this.#client
          .prepare(
            'UPDATE job_applications SET status = ?, status_effective_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          )
          .run(nextStatus, input.effectiveAt, input.now, input.applicationId);
      }
      return true;
    });
    return transaction();
  }
}

function toMessageRef(row: Record<string, unknown>): MailMessageRefRecord {
  return {
    id: String(row.id),
    mailboxKey: String(row.mailbox_key),
    providerKey: String(row.provider_key),
    externalMessageKey: String(row.external_message_key),
    threadKeyHash: typeof row.thread_key_hash === 'string' ? row.thread_key_hash : null,
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
    receivedAt: Number(row.received_at),
    contentVersion: String(row.content_version),
    contentHash: typeof row.content_hash === 'string' ? row.content_hash : null,
    processingStatus: String(row.processing_status),
    lastClassifierKind:
      typeof row.last_classifier_kind === 'string' ? row.last_classifier_kind : null,
    lastClassifierVersion:
      typeof row.last_classifier_version === 'string' ? row.last_classifier_version : null,
    lastSeenAt: Number(row.last_seen_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
