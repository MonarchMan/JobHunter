import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';
import { labelAgentErrorCategory, labelAgentKey } from '../app/components/status-labels.js';
import { taskTimeRange } from '../src/server/task-time-range.js';

describe('Agent 诊断展示标签', () => {
  it('将已知及未知 Agent 名称和错误分类转换为中文', () => {
    expect(labelAgentKey('recruitment-mail.classify')).toBe('招聘邮件分析');
    expect(labelAgentKey('interview.community-research-configured-model')).toBe('面经研究');
    expect(labelAgentKey('future.agent')).toBe('未知');
    expect(labelAgentErrorCategory('unknown')).toBe('未知错误');
    expect(labelAgentErrorCategory('future_error')).toBe('其他错误');
  });
});

const failedTaskId = '018f0000-0000-7000-8000-000000000701';
const pendingTaskId = '018f0000-0000-7000-8000-000000000702';
const agentRunId = '018f0000-0000-7000-8000-000000000703';
const batchTaskId = '018f0000-0000-7000-8000-000000000705';

/** 构造测试输入或执行断言的辅助逻辑。 */
function seedDiagnostics(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    const insertTask = database.client.prepare(
      `INSERT INTO tasks
       (id, task_type, private_state, status, priority, idempotency_key, concurrency_key,
        attempt_count, available_at,
        error_category, error_summary, created_at, started_at, finished_at)
       VALUES (?, 'source.health-check', ?, ?, 0, ?, NULL, ?, 1, ?, ?, 1, ?, ?)`,
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
    // 批量检查点保留内部结果，但诊断列表和单条查询只允许输出汇总进度。
    database.client
      .prepare(
        `INSERT INTO tasks
      (id, task_type, private_state, public_state, status, idempotency_key,
       attempt_count, available_at, created_at, started_at)
      VALUES (?, 'match.score-batch', ?, ?, 'running', 'fixture-batch-progress', 1, 1, 1, 1)`,
      )
      .run(
        batchTaskId,
        JSON.stringify({ jobRevisionIds: ['a', 'b', 'c'] }),
        JSON.stringify({
          items: [
            { jobRevisionId: 'a', status: 'succeeded', result: { private: 'secret-result' } },
            { jobRevisionId: 'b', status: 'failed', result: null, error: 'secret-error' },
          ],
        }),
      );
    database.client
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_key, definition_hash, model_config_hash, input_hash,
          cache_key, status, output_json, input_tokens, output_tokens, estimated_cost_micros,
          cost_currency, pricing_version, started_at, finished_at)
         VALUES (?, 'resume-profile', 'definition-fingerprint', 'model-fingerprint',
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
  it('filters both lists and pagination totals with inclusive day starts and exclusive ends', async () => {
    const root = await createTemporaryDataRoot('jobhunter-diagnostics-time-');
    try {
      const now = Date.parse('2026-11-08T04:00:00Z');
      const midnight = Date.parse('2026-11-07T16:00:00Z');
      const day = 86_400_000;
      const times = [
        midnight - 30 * day,
        midnight - 29 * day,
        midnight - 6 * day,
        midnight - 1,
        midnight,
        midnight + day - 1,
        midnight + day,
      ];
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        const task = database.client.prepare(`INSERT INTO tasks
          (id,task_type,private_state,status,idempotency_key,attempt_count,available_at,created_at)
          VALUES (?,'source.health-check','{}','pending',?,0,1,?)`);
        const agent = database.client.prepare(`INSERT INTO agent_runs
          (id,agent_key,definition_hash,model_config_hash,input_hash,cache_key,status,started_at)
          VALUES (?,'job-analysis','fixture','fixture','fixture',?,'succeeded',?)`);
        for (const [index, time] of times.entries()) {
          const id = `018f0000-0000-7000-8000-${String(index + 800).padStart(12, '0')}`;
          task.run(id, `time-task-${String(index)}`, time);
          agent.run(id, `time-agent-${String(index)}`, time);
        }
      } finally {
        database.close();
      }
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        for (const [range, total] of [
          ['today', 2],
          ['7d', 4],
          ['30d', 5],
          ['all', 7],
        ] as const) {
          const { range: _range, ...timeFilter } = taskTimeRange(range, now);
          void _range;
          const result = container.services.diagnostics.list({
            ...timeFilter,
            pageSize: 1,
            taskPage: 99,
            agentPage: 99,
          });
          expect(result.taskPagination).toMatchObject({ current: total, total, totalPages: total });
          expect(result.agentPagination).toMatchObject({
            current: total,
            total,
            totalPages: total,
          });
          expect(result.tasks).toHaveLength(1);
          expect(result.agentRuns).toHaveLength(1);
        }
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('redacts private data and supports idempotent retry and cancellation', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-diagnostics-');
    try {
      seedDiagnostics(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        const diagnostics = container.services.diagnostics.list();
        expect(diagnostics.tasks).toHaveLength(3);
        expect(diagnostics.tasks.find((task) => task.id === batchTaskId)?.batchProgress).toEqual({
          total: 3,
          processed: 2,
        });
        expect(container.services.diagnostics.getTask(batchTaskId)?.batchProgress).toEqual({
          total: 3,
          processed: 2,
        });
        expect(JSON.stringify(diagnostics)).not.toContain('secret-');
        expect(JSON.stringify(container.services.diagnostics.getTask(batchTaskId))).not.toContain(
          'secret-',
        );
        expect(JSON.stringify(diagnostics)).not.toContain('018f0000-0000-7000-8000-000000000201');
        expect(diagnostics.agentRuns).toMatchObject([
          {
            id: agentRunId,
            agentKey: 'resume-profile',
            definitionHash: 'definition-fingerprint',
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
      const config = resolveAppConfig({ bootstrap, environment: {} });
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
             (id, task_type, private_state, status, priority, idempotency_key, concurrency_key,
              attempt_count, available_at, created_at, started_at, finished_at)
             VALUES (?, 'source.sync', ?, 'succeeded', 0, 'sync-detail-task', ?, 2, 100, 100, 200, 500)`,
          )
          .run(
            taskId,
            JSON.stringify({ sourceId, trigger: 'schedule' }),
            `source-sync:${sourceId}`,
          );
        const insertRun = database.client.prepare(
          `WITH scan_input (id, source_id, trigger, status, coverage, stats_json, started_at, finished_at) AS (VALUES (?, ?, 'schedule', ?, ?, ?, ?, ?))
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_input.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,started_at,started_at,started_at,scan_input.finished_at,NULL,NULL FROM scan_input`,
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
        expect(
          container.services.diagnostics.list().tasks.find((task) => task.id === taskId),
        ).toEqual(container.services.diagnostics.getTask(taskId));
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
      const config = resolveAppConfig({ bootstrap, environment: {} });
      createLocalWebContainer(config).close();
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        const insert = database.client.prepare(
          `INSERT INTO tasks
           (id, task_type, private_state, status, priority, idempotency_key, concurrency_key,
            attempt_count, available_at, created_at, started_at, finished_at)
           VALUES (?, 'source.job-detail', ?, ?, 0, ?, ?, 1, 100, ?, ?, ?)`,
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
        // 原地重试只更新原任务，批次总数不随重试增加。
        database.client
          .prepare(
            "UPDATE tasks SET status='succeeded', attempt_count=2, finished_at=204 WHERE id=?",
          )
          .run('018f0000-0000-7000-8000-000000000732');
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
             (id, task_type, private_state, status, priority, idempotency_key,
              attempt_count, available_at, created_at)
             VALUES ('018f0000-0000-7000-8000-000000000736', 'source.health-check', '{}',
                     'pending', 0, 'health-alongside-batches', 0, 100, 400)`,
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
        const batchWindow = container.services.diagnostics.list({
          taskType: 'source.job-detail',
          since: 200,
          before: 201,
        });
        expect(batchWindow.taskPagination.total).toBe(1);
        expect(batchWindow.tasks[0]?.jobDetailBatch?.counts.total).toBe(3);
        expect(
          container.services.diagnostics.list({
            taskType: 'source.job-detail',
            since: 201,
            before: 300,
          }).taskPagination.total,
        ).toBe(0);
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

        const outOfRange = container.services.diagnostics.list({
          taskType: 'source.job-detail',
          taskPage: 99,
        });
        expect(outOfRange.taskPagination).toMatchObject({ current: 1, total: 2 });
        expect(outOfRange.tasks).toHaveLength(2);

        const empty = container.services.diagnostics.list({
          taskType: 'source.job-detail',
          status: 'cancelled',
        });
        expect(empty.taskPagination.total).toBe(0);
        expect(empty.tasks).toHaveLength(0);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
