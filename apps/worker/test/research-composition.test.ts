import { openSqliteDatabase, SqliteTaskRepository } from '@jobhunter/db';
import { parseId, utcInstant } from '@jobhunter/domain';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProductionWorkerApplication } from '../src/index.js';

const taskType = 'interview.experience-research.execute';

describe('production research composition', () => {
  it('registers the real research handler without invoking Codex for a stale request', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'jobhunter-worker-research-composition-'));
    const taskId = parseId('018f0000-0000-7000-8000-00000000c101', 'Task');
    const requestId = '018f0000-0000-7000-8000-00000000c102';
    try {
      const database = openSqliteDatabase({ dataRoot });
      try {
        new SqliteTaskRepository(database.client).enqueue({
          id: taskId,
          taskType,
          payload: {
            requestId,
            requestFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            executorKey: 'codex-local',
          },
          priority: 0,
          idempotencyKey: 'research-composition-fixture',
          concurrencyKey: `experience-research:${requestId}`,
          scheduleId: null,
          retryOfTaskId: null,
          maxAttempts: 2,
          availableAt: utcInstant(1),
          createdAt: utcInstant(1),
        });
      } finally {
        database.close();
      }

      const worker = createProductionWorkerApplication({
        dataRoot,
        workerId: 'research-composition',
      });
      try {
        await expect(worker.engine.runOnce(taskType)).resolves.toBe(true);
      } finally {
        await worker.close();
      }

      const verification = openSqliteDatabase({ dataRoot });
      try {
        expect(new SqliteTaskRepository(verification.client).get(taskId)).toMatchObject({
          status: 'failed',
          errorCategory: 'cancelled',
          errorSummary: 'Research request context is stale.',
        });
      } finally {
        verification.close();
      }
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
