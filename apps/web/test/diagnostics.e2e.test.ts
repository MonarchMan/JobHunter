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
        `INSERT INTO agent_tool_calls
         (id, agent_run_id, sequence_no, tool_key, input_summary_json, output_summary_json,
          status, duration_ms, error_summary)
         VALUES ('018f0000-0000-7000-8000-000000000704', ?, 0, 'resume.read',
          '{"private":"input"}', '{"private":"output"}', 'succeeded', 25, NULL)`,
      )
      .run(agentRunId);
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
});
