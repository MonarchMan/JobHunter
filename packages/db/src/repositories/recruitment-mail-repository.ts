import type Database from 'better-sqlite3';
import { projectApplicationStatus, type RecruitmentScheduleFact } from '@jobhunter/domain';
import {
  calendarSourceEventSchema,
  type MailSyncRepository,
  type RecruitmentMailMessageRef,
  type RecruitmentMailProcessingRepository,
  type CalendarSourceEvent,
} from '@jobhunter/application';
import { createHash } from 'node:crypto';

/** 数据库中的招聘邮件引用行。 */
export interface MailMessageRefRecord {
  readonly id: string;
  readonly mailboxKey: string;
  readonly providerKey: string;
  readonly externalMessageKey: string;
  readonly folderId: string;
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
  readonly schedule?: RecruitmentScheduleFact | null;
  readonly location?: string | null;
  readonly meetingUrl?: string | null;
  readonly actionUrl?: string | null;
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
        id, mailbox_key, provider_key, external_message_key, folder_id, thread_key_hash, source_url,
        received_at, content_version, content_hash, processing_status, last_classifier_kind,
        last_classifier_version, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mailbox_key, external_message_key) DO UPDATE SET
        folder_id = excluded.folder_id,
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
        input.folderId,
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

  /** 同步页幂等写入最小引用；线程键只保存不可逆哈希。 */
  public saveMessageRefs(
    refs: Parameters<MailSyncRepository['saveMessageRefs']>[0],
    now = Date.now(),
  ): void {
    const transaction = this.#client.transaction(() => {
      for (const reference of refs) {
        const existing = this.#findByExternalIdentity(
          reference.mailboxKey,
          reference.externalMessageKey,
        );
        this.upsertMessageRef({
          id:
            existing?.id ?? stableMessageRefId(reference.mailboxKey, reference.externalMessageKey),
          mailboxKey: reference.mailboxKey,
          providerKey: reference.providerKey,
          externalMessageKey: reference.externalMessageKey,
          folderId: reference.folderId,
          threadKeyHash: reference.threadKey ? sha256(reference.threadKey) : null,
          sourceUrl: reference.sourceUrl,
          receivedAt: reference.receivedAt,
          contentVersion: reference.contentVersion,
          contentHash: existing?.contentHash ?? null,
          processingStatus: existing?.processingStatus ?? 'discovered',
          lastClassifierKind: existing?.lastClassifierKind ?? null,
          lastClassifierVersion: existing?.lastClassifierVersion ?? null,
          lastSeenAt: now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
      }
    });
    transaction();
  }

  /** 按内部引用恢复连接器所需的最小外部身份。 */
  public findProcessingMessageRef(id: string): RecruitmentMailMessageRef | null {
    const row = this.#client.prepare('SELECT * FROM mail_message_refs WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      mailboxKey: String(row.mailbox_key),
      providerKey: String(row.provider_key) as RecruitmentMailMessageRef['providerKey'],
      externalMessageKey: String(row.external_message_key),
      folderId: String(row.folder_id),
      threadKey: null,
      receivedAt: Number(row.received_at),
      contentVersion: String(row.content_version),
      sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
      changeKind: 'added',
    };
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

  /** 适配应用端口使用的对象参数，避免处理器接触 SQL 细节。 */
  public updateProcessingStatus(
    input: Parameters<RecruitmentMailProcessingRepository['updateMessageStatus']>[0],
  ): void {
    this.updateMessageStatus(
      input.id,
      input.status,
      input.classifierKind,
      input.classifierVersion,
      input.contentHash,
      input.updatedAt,
    );
  }

  /** 查询申请时间线，供 Web 或 CLI 展示。 */
  public listApplicationEvents(applicationId: string): readonly Record<string, unknown>[] {
    return this.#client
      .prepare(
        'SELECT * FROM application_events WHERE application_id = ? ORDER BY effective_at, sequence_no',
      )
      .all(applicationId) as Record<string, unknown>[];
  }

  /** 读取会影响招聘日历的申请事件，并在数据库边界恢复类型化日程事实。 */
  public listScheduleEvents(): readonly CalendarSourceEvent[] {
    const rows = this.#client
      .prepare(
        `SELECT
          event.id,
          event.application_id,
          event.sequence_no,
          application.company_name,
          application.role_title,
          event.event_type,
          event.effective_at,
          event.received_at,
          event.activity_type,
          event.scheduled_start_at,
          event.scheduled_end_at,
          event.deadline_at,
          event.scheduled_start_local_date,
          event.scheduled_end_local_date,
          event.deadline_local_date,
          event.previous_scheduled_start_at,
          event.previous_scheduled_start_local_date,
          event.time_precision,
          event.timezone_source,
          event.timezone_text,
          event.stage_label,
          event.location,
          event.meeting_url,
          event.action_url
        FROM application_events AS event
        INNER JOIN job_applications AS application ON application.id = event.application_id
        WHERE event.event_type IN (
          'assessment_invited',
          'interview_invited',
          'interview_rescheduled',
          'interview_cancelled'
        )
          AND event.activity_type IS NOT NULL
        ORDER BY event.application_id, event.sequence_no`,
      )
      .all() as Record<string, unknown>[];

    // 1、数据库只负责筛选候选行；2、运行时 Schema 负责拒绝残缺枚举、非法 URL 和时间结构。
    return rows.map((row) =>
      calendarSourceEventSchema.parse({
        id: row.id,
        applicationId: row.application_id,
        sequenceNo: row.sequence_no,
        companyName: row.company_name,
        roleTitle: row.role_title,
        eventType: row.event_type,
        effectiveAt: row.effective_at,
        receivedAt: row.received_at,
        schedule: {
          activityType: row.activity_type,
          scheduledStartAt: nullableNumber(row.scheduled_start_at),
          scheduledEndAt: nullableNumber(row.scheduled_end_at),
          deadlineAt: nullableNumber(row.deadline_at),
          scheduledStartLocalDate: nullableString(row.scheduled_start_local_date),
          scheduledEndLocalDate: nullableString(row.scheduled_end_local_date),
          deadlineLocalDate: nullableString(row.deadline_local_date),
          previousScheduledStartAt: nullableNumber(row.previous_scheduled_start_at),
          previousScheduledStartLocalDate: nullableString(row.previous_scheduled_start_local_date),
          timePrecision: row.time_precision,
          timezoneSource: row.timezone_source,
          timezoneText: nullableString(row.timezone_text),
          stageLabel: nullableString(row.stage_label),
        },
        location: nullableString(row.location),
        meetingUrl: nullableString(row.meeting_url),
        actionUrl: nullableString(row.action_url),
      }),
    );
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
            effective_at, received_at, confidence, activity_type, scheduled_start_at,
            scheduled_end_at, deadline_at, scheduled_start_local_date, scheduled_end_local_date,
            deadline_local_date, previous_scheduled_start_at, previous_scheduled_start_local_date,
            time_precision, timezone_source, timezone_text, stage_label, location, meeting_url,
            action_url, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.schedule?.activityType ?? null,
          input.schedule?.scheduledStartAt ?? null,
          input.schedule?.scheduledEndAt ?? null,
          input.schedule?.deadlineAt ?? null,
          input.schedule?.scheduledStartLocalDate ?? null,
          input.schedule?.scheduledEndLocalDate ?? null,
          input.schedule?.deadlineLocalDate ?? null,
          input.schedule?.previousScheduledStartAt ?? null,
          input.schedule?.previousScheduledStartLocalDate ?? null,
          input.schedule?.timePrecision ?? null,
          input.schedule?.timezoneSource ?? null,
          input.schedule?.timezoneText ?? null,
          input.schedule?.stageLabel ?? null,
          input.location ?? null,
          input.meetingUrl ?? null,
          input.actionUrl ?? null,
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

  /** 按邮箱和外部稳定键读取已有引用，供同步页重放时沿用内部身份。 */
  #findByExternalIdentity(
    mailboxKey: string,
    externalMessageKey: string,
  ): MailMessageRefRecord | null {
    const row = this.#client
      .prepare('SELECT * FROM mail_message_refs WHERE mailbox_key = ? AND external_message_key = ?')
      .get(mailboxKey, externalMessageKey) as Record<string, unknown> | undefined;
    return row ? toMessageRef(row) : null;
  }
}

/** 组合数据库引用写入与 Worker 发布器，保持数据库包不依赖具体任务队列。 */
export function createRecruitmentMailSyncRepository(input: {
  readonly repository: SqliteRecruitmentMailRepository;
  readonly enqueueClassification: MailSyncRepository['enqueueClassification'];
  readonly now?: () => number;
}): MailSyncRepository {
  return {
    saveMessageRefs: (refs) => {
      input.repository.saveMessageRefs(refs, input.now?.() ?? Date.now());
      return Promise.resolve();
    },
    enqueueClassification: input.enqueueClassification,
  };
}

/** 将数据库仓储包装为应用层分类端口，保持已有公开方法兼容。 */
export function createRecruitmentMailProcessingRepository(
  repository: SqliteRecruitmentMailRepository,
): RecruitmentMailProcessingRepository {
  return {
    findMessageRef: (id) => repository.findProcessingMessageRef(id),
    updateMessageStatus: (input) => {
      repository.updateProcessingStatus(input);
    },
    appendAcceptedApplicationEvent: (input) =>
      repository.appendAcceptedApplicationEvent({
        ...input,
        sourceEventNo: 1,
        acceptanceKind: 'automatic',
      }),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableMessageRefId(mailboxKey: string, externalMessageKey: string): string {
  return recruitmentMailMessageRefId(mailboxKey, externalMessageKey);
}

/** 根据邮箱连接和外部消息身份计算稳定的内部引用 ID。 */
export function recruitmentMailMessageRefId(
  mailboxKey: string,
  externalMessageKey: string,
): string {
  return `mail-ref-${sha256(`${mailboxKey}\u0000${externalMessageKey}`).slice(0, 40)}`;
}

function toMessageRef(row: Record<string, unknown>): MailMessageRefRecord {
  return {
    id: String(row.id),
    mailboxKey: String(row.mailbox_key),
    providerKey: String(row.provider_key),
    externalMessageKey: String(row.external_message_key),
    folderId: String(row.folder_id),
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

/** 将 SQLite 可空整数恢复为应用层时间戳输入。 */
function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** 将 SQLite 可空文本恢复为应用层字符串输入。 */
function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
