import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const failedTaskId = '018f0000-0000-7000-8000-000000000701';
const pendingTaskId = '018f0000-0000-7000-8000-000000000702';
const agentRunId = '018f0000-0000-7000-8000-000000000703';

function seedDiagnostics(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    const insertTask = database.client.prepare(
      `INSERT INTO tasks
       (id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
        schedule_id, retry_of_task_id, attempt_count, max_attempts, available_at,
        error_category, error_summary, created_at, started_at, finished_at)
       VALUES (?, 'source.health-check', ?, ?, 0, ?, NULL, NULL, NULL, ?, 3, 1, ?, ?, 1, ?, ?)`,
    );
    insertTask.run(
      failedTaskId,
      '{"sourceId":"018f0000-0000-7000-8000-000000000201"}',
      'failed',
      'failed-task',
      3,
      'network_temporary',
      'Connection timed out.',
      1,
      2,
    );
    insertTask.run(
      pendingTaskId,
      '{"sourceId":"018f0000-0000-7000-8000-000000000201"}',
      'pending',
      'pending-task',
      0,
      null,
      null,
      null,
      null,
    );
    database.client
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
          cache_key, status, output_json, input_tokens, output_tokens, estimated_cost_micros,
          cost_currency, pricing_version, started_at, finished_at)
         VALUES (?, 'resume-profile', '1.2.0', 'prompt-v3', 'model-fingerprint',
          'private-input-hash', 'cache-key', 'succeeded', '{"private":"output"}',
          120, 45, 1234, 'USD', '2026-08', 1, 2)`,
      )
      .run(agentRunId);
    database.client
      .prepare(
        `INSERT INTO events
         (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
         VALUES ('018f0000-0000-7000-8000-000000000704', 'agent_run', ?, 1,
          'agent.tool.finished', ?, 1)`,
      )
      .run(
        agentRunId,
        JSON.stringify({
          toolKey: 'resume.read',
          inputSummary: { private: 'input' },
          outputSummary: { private: 'output' },
          status: 'succeeded',
          durationMs: 25,
          errorSummary: null,
        }),
      );
  } finally {
    database.close();
  }
}

describe('Web diagnostics', () => {
  it('redacts private data and supports idempotent retry and cancellation', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-diagnostics-');
    try {
      seedDiagnostics(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const diagnostics = container.services.diagnostics.list();
        expect(diagnostics.tasks).toHaveLength(2);
        expect(JSON.stringify(diagnostics)).not.toContain('018f0000-0000-7000-8000-000000000201');
        expect(diagnostics.agentRuns).toMatchObject([
          {
            id: agentRunId,
            agentKey: 'resume-profile',
            agentVersion: '1.2.0',
            promptVersion: 'prompt-v3',
            inputTokens: 120,
            outputTokens: 45,
            estimatedCostMicros: 1234,
          },
        ]);

        const run = container.services.diagnostics.getAgentRun(agentRunId);
        expect(run).toMatchObject({
          toolCalls: [{ toolKey: 'resume.read', status: 'succeeded', durationMs: 25 }],
        });
        expect(JSON.stringify(run)).not.toContain('private');

        const retry = {
          kind: 'retry' as const,
          taskId: failedTaskId,
          idempotencyToken: 'retry-request-token',
        };
        const first = container.services.diagnostics.mutate(retry);
        const second = container.services.diagnostics.mutate(retry);
        expect(first).toMatchObject({ kind: 'accepted', task: { deduplicated: false } });
        expect(second).toMatchObject({
          kind: 'accepted',
          task: {
            taskId: first.kind === 'accepted' ? first.task.taskId : '',
            deduplicated: true,
          },
        });

        const cancelled = container.services.diagnostics.mutate({
          kind: 'cancel',
          taskId: pendingTaskId,
        });
        expect(cancelled).toMatchObject({ kind: 'task', task: { status: 'cancelled' } });
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('shows source ownership and the latest synchronization attempt statistics', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-sync-task-detail-');
    try {
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const config = resolveAppConfig({ bootstrap, environment: {}, file: {} });
      createLocalWebContainer(config).close();
      const taskId = '018f0000-0000-7000-8000-000000000711';
      const sourceId = '018f0000-0000-7000-8000-000000000205';
      const stats = (discovered: number): string =>
        JSON.stringify({
          discovered,
          created: 1,
          revised: 2,
          unchanged: discovered - 4,
          skippedNonDomestic: 0,
          skippedOutOfScope: 1,
          skippedUnknownRegion: 0,
          isolated: 0,
          restored: 0,
          staled: 0,
          closed: 0,
          followupEnqueued: 3,
        });
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        database.client
          .prepare(
            `INSERT INTO tasks
             (id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
              attempt_count, max_attempts, available_at, created_at, started_at, finished_at)
             VALUES (?, 'source.sync', ?, 'succeeded', 0, 'sync-detail-task', ?, 2, 3, 100, 100, 200, 500)`,
          )
          .run(
            taskId,
            JSON.stringify({ sourceId, trigger: 'schedule' }),
            `source-sync:${sourceId}`,
          );
        const insertRun = database.client.prepare(
          `INSERT INTO sync_runs
           (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
            sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
           VALUES (?, ?, 'schedule', ?, ?, 'v1', 'v1', 'v1', 'hash', ?, ?, ?)`,
        );
        insertRun.run(
          '018f0000-0000-7000-8000-000000000712',
          sourceId,
          'failed',
          'unknown',
          stats(2),
          250,
          300,
        );
        insertRun.run(
          '018f0000-0000-7000-8000-000000000713',
          sourceId,
          'succeeded',
          'complete',
          stats(8),
          400,
          450,
        );
      } finally {
        database.close();
      }

      const container = createLocalWebContainer(config);
      try {
        expect(container.services.diagnostics.getTask(taskId)?.sourceSync).toMatchObject({
          companyName: '拼多多',
          channel: 'intern',
          trigger: 'schedule',
          run: {
            id: '018f0000-0000-7000-8000-000000000713',
            status: 'succeeded',
            coverage: 'complete',
            stats: { discovered: 8, created: 1, revised: 2, followupEnqueued: 3 },
          },
        });
        expect(JSON.stringify(container.services.diagnostics.getTask(taskId))).not.toContain(
          sourceId,
        );
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('groups job detail children into source synchronization batches', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-detail-batches-');
    try {
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const config = resolveAppConfig({ bootstrap, environment: {}, file: {} });
      createLocalWebContainer(config).close();
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        const insert = database.client.prepare(
          `INSERT INTO tasks
           (id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
            attempt_count, max_attempts, available_at, created_at, started_at, finished_at)
           VALUES (?, 'source.job-detail', ?, ?, 0, ?, ?, 1, 3, 100, ?, ?, ?)`,
        );
        const pinduoduoRun = '018f0000-0000-7000-8000-000000000721';
        const meituanRun = '018f0000-0000-7000-8000-000000000722';
        const pinduoduoSource = '018f0000-0000-7000-8000-000000000205';
        const meituanSource = '018f0000-0000-7000-8000-000000000212';
        const detail = (
          id: string,
          runId: string,
          sourceId: string,
          status: 'succeeded' | 'failed',
          createdAt: number,
        ): void => {
          insert.run(
            id,
            JSON.stringify({ sourceId, runId }),
            status,
            `detail-${id}`,
            `source-detail:${sourceId}:${id}`,
            createdAt,
            createdAt + 1,
            createdAt + 2,
          );
        };
        detail(
          '018f0000-0000-7000-8000-000000000731',
          pinduoduoRun,
          pinduoduoSource,
          'succeeded',
          200,
        );
        detail(
          '018f0000-0000-7000-8000-000000000732',
          pinduoduoRun,
          pinduoduoSource,
          'failed',
          201,
        );
        database.client
          .prepare(
            `INSERT INTO tasks
             (id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
              retry_of_task_id, attempt_count, max_attempts, available_at, created_at,
              started_at, finished_at)
             VALUES (?, 'source.job-detail', ?, 'succeeded', 0, ?, ?, ?, 1, 3, 100, 202, 203, 204)`,
          )
          .run(
            '018f0000-0000-7000-8000-000000000737',
            JSON.stringify({ sourceId: pinduoduoSource, runId: pinduoduoRun }),
            'detail-retry-success',
            `source-detail:${pinduoduoSource}:retry`,
            '018f0000-0000-7000-8000-000000000732',
          );
        detail(
          '018f0000-0000-7000-8000-000000000738',
          pinduoduoRun,
          pinduoduoSource,
          'failed',
          205,
        );
        for (const [index, id] of [
          '018f0000-0000-7000-8000-000000000733',
          '018f0000-0000-7000-8000-000000000734',
          '018f0000-0000-7000-8000-000000000735',
        ].entries()) {
          detail(id, meituanRun, meituanSource, 'succeeded', 300 + index);
        }
        database.client
          .prepare(
            `INSERT INTO tasks
             (id, task_type, payload_json, status, priority, idempotency_key,
              attempt_count, max_attempts, available_at, created_at)
             VALUES ('018f0000-0000-7000-8000-000000000736', 'source.health-check', '{}',
                     'pending', 0, 'health-alongside-batches', 0, 3, 100, 400)`,
          )
          .run();
      } finally {
        database.close();
      }

      const container = createLocalWebContainer(config);
      try {
        const all = container.services.diagnostics.list();
        expect(all.taskPagination.total).toBe(3);
        expect(all.tasks).toHaveLength(3);
        expect(all.tasks.filter((task) => task.taskType === 'source.job-detail')).toHaveLength(2);

        const details = container.services.diagnostics.list({ taskType: 'source.job-detail' });
        expect(details.taskPagination.total).toBe(2);
        expect(details.tasks).toMatchObject([
          {
            kind: 'source_job_detail_batch',
            status: 'succeeded',
            jobDetailBatch: {
              companyName: '美团',
              counts: { total: 3, succeeded: 3, failed: 0 },
            },
          },
          {
            kind: 'source_job_detail_batch',
            status: 'failed',
            jobDetailBatch: {
              companyName: '拼多多',
              counts: { total: 3, succeeded: 2, failed: 1 },
            },
          },
        ]);
        expect(JSON.stringify(details)).not.toContain('000000000731');

        const failed = container.services.diagnostics.list({
          taskType: 'source.job-detail',
          status: 'failed',
        });
        expect(failed.taskPagination.total).toBe(1);
        expect(failed.tasks[0]?.jobDetailBatch?.companyName).toBe('拼多多');
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
