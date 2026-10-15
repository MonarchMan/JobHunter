import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase, SqliteRecruitmentMailRepository } from '../src/index.js';

describe('recruitment mail persistence', () => {
  it('migrates the three tables and deduplicates message references', async () => {
    const root = await createTemporaryDataRoot('jobhunter-mail-');
    const handle = openSqliteDatabase({ dataRoot: root.path });
    try {
      const tables = handle.client
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mail_message_refs', 'job_applications', 'application_events') ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'application_events',
        'job_applications',
        'mail_message_refs',
      ]);
      const repository = new SqliteRecruitmentMailRepository(handle.client);
      const first = {
        id: 'mail-1',
        mailboxKey: 'personal',
        providerKey: 'imap',
        externalMessageKey: 'INBOX:1:2',
        threadKeyHash: null,
        sourceUrl: null,
        receivedAt: 100,
        contentVersion: '1:2',
        contentHash: null,
        processingStatus: 'discovered',
        lastClassifierKind: null,
        lastClassifierVersion: null,
        lastSeenAt: 100,
        createdAt: 100,
        updatedAt: 100,
      } as const;
      repository.upsertMessageRef(first);
      repository.upsertMessageRef({
        ...first,
        contentVersion: '1:3',
        lastSeenAt: 200,
        updatedAt: 200,
      });
      expect(repository.findMessageRef('mail-1')?.contentVersion).toBe('1:3');
      expect(
        handle.client.prepare('SELECT count(*) AS count FROM mail_message_refs').get(),
      ).toEqual({ count: 1 });
      expect(
        repository.appendAcceptedApplicationEvent({
          applicationId: 'application-1',
          companyName: '示例公司',
          roleTitle: '后端工程师',
          mailMessageRefId: 'mail-1',
          sourceContentHash: 'a'.repeat(64),
          sourceEventNo: 1,
          acceptanceKind: 'automatic',
          classifierKind: 'rules',
          classifierVersion: 'rules-v1',
          eventType: 'interview_invited',
          effectiveAt: 300,
          receivedAt: 100,
          confidence: 0.9,
          payloadJson: '{}',
          eventId: 'event-1',
          now: 300,
        }),
      ).toBe(true);
      expect(
        repository.appendAcceptedApplicationEvent({
          applicationId: 'application-1',
          companyName: '示例公司',
          roleTitle: '后端工程师',
          mailMessageRefId: 'mail-1',
          sourceContentHash: 'a'.repeat(64),
          sourceEventNo: 1,
          acceptanceKind: 'automatic',
          classifierKind: 'rules',
          classifierVersion: 'rules-v2',
          eventType: 'interview_invited',
          effectiveAt: 300,
          receivedAt: 100,
          confidence: 0.9,
          payloadJson: '{}',
          eventId: 'event-duplicate',
          now: 301,
        }),
      ).toBe(false);
      expect(
        handle.client
          .prepare('SELECT status FROM job_applications WHERE id = ?')
          .get('application-1'),
      ).toEqual({ status: 'interview' });
    } finally {
      handle.close();
    }
  });
});
