import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { openSqliteDatabase, SqliteTaskRepository } from '@jobhunter/db';
import { parseId, utcInstant } from '@jobhunter/domain';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalCli, type CliIo } from '../src/index.js';

function memoryIo(): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
  };
}

async function command(
  dataRoot: string,
  argv: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly body: Record<string, unknown>;
  readonly stderr: string;
}> {
  const output = memoryIo();
  const exitCode = await runLocalCli({
    argv: ['--json', '--data-root', dataRoot, ...argv],
    io: output.io,
    environment: {},
  });
  return {
    exitCode,
    body: JSON.parse(output.stdout.join('')) as Record<string, unknown>,
    stderr: output.stderr.join(''),
  };
}

describe('source and task commands', () => {
  it('lists sources and manages a queued source synchronization', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-source-');
    const dataRoot = path.join(root.path, '中文 数据');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const database = openSqliteDatabase({ dataRoot });
      try {
        const profile = JSON.stringify({
          basicInfo: { name: null, phone: null, email: null, location: null, website: null },
          targetRoles: ['后端开发'],
          preferences: {
            locations: [],
            companySizes: [],
            employmentTypes: [],
            excludedTerms: [],
            remoteAccepted: null,
          },
          education: [],
          workExperience: [],
          projects: [],
          works: [],
          competitions: [],
          certificates: [],
          languages: [],
          skills: [],
          domains: [],
          yearsOfExperience: null,
          managementExperience: null,
        });
        database.client
          .prepare(
            `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
             VALUES ('018f0000-0000-7000-8000-000000000401', '测试画像', 1, 1)`,
          )
          .run();
        database.client
          .prepare(
            `INSERT INTO profile_versions
             (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
              content_hash, is_current, created_at)
             VALUES ('018f0000-0000-7000-8000-000000000402',
                     '018f0000-0000-7000-8000-000000000401', 1, ?, ?, '[]', ?, 1, 1)`,
          )
          .run(profile, profile, 'a'.repeat(64));
      } finally {
        database.close();
      }
      const listed = await command(dataRoot, ['source', 'list']);
      expect(listed.exitCode).toBe(0);
      expect(listed.stderr).toBe('');
      expect(listed.body).toMatchObject({ ok: true });
      expect(Array.isArray((listed.body as { data?: { sources?: unknown } }).data?.sources)).toBe(
        true,
      );

      const synchronized = await command(dataRoot, ['source', 'sync', 'tencent-intern']);
      expect(synchronized.exitCode).toBe(0);
      const taskId = (
        synchronized.body as { data: { tasks: readonly { id: string; status: string }[] } }
      ).data.tasks[0]?.id;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/u);

      const tasks = await command(dataRoot, ['task', 'list', '--status', 'pending']);
      expect(tasks.body).toMatchObject({ ok: true });
      const pendingTasks = (tasks.body as { data?: { tasks?: readonly { id: string }[] } }).data
        ?.tasks;
      expect(pendingTasks?.some((task) => task.id === taskId)).toBe(true);
      expect((await command(dataRoot, ['task', 'show', taskId ?? 'missing'])).exitCode).toBe(0);
      expect((await command(dataRoot, ['task', 'cancel', taskId ?? 'missing'])).body).toMatchObject(
        {
          ok: true,
          data: { kind: 'cancelled' },
        },
      );

      const missing = await command(dataRoot, [
        'task',
        'show',
        '018f0000-0000-7000-8000-000000009999',
      ]);
      expect(missing.exitCode).toBe(3);
      expect(missing.body).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
      expect(missing.stderr).toBe('');
    } finally {
      await root.cleanup();
    }
  });

  it('retries research tasks through the CLI unavailable handler registration', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-research-task-');
    const dataRoot = path.join(root.path, '研究任务');
    const taskId = parseId('018f0000-0000-7000-8000-00000000c201', 'Task');
    const requestId = '018f0000-0000-7000-8000-00000000c202';
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const database = openSqliteDatabase({ dataRoot });
      try {
        new SqliteTaskRepository(database.client).enqueue({
          id: taskId,
          taskType: 'interview.experience-research.execute',
          payload: {
            requestId,
            requestFingerprint: 'b'.repeat(64),
            expectedRevision: 0,
            executorKey: 'codex-local',
          },
          priority: 0,
          idempotencyKey: 'cli-research-retry-fixture',
          concurrencyKey: `experience-research:${requestId}`,
          scheduleId: null,
          retryOfTaskId: null,
          maxAttempts: 2,
          availableAt: utcInstant(1),
          createdAt: utcInstant(1),
        });
        database.client
          .prepare(
            `UPDATE tasks SET status = 'failed', attempt_count = 2, finished_at = 2,
             error_category = 'invalid_config', error_summary = 'fixture failure'
             WHERE id = ?`,
          )
          .run(taskId);
        database.client
          .prepare(
            `INSERT INTO files
             (id, kind, name, state, revision, properties_json, created_at, updated_at)
             VALUES (?, 'interview_research', ?, 'stored', 0, '{}', 1, 1),
                    (?, 'interview_research', ?, 'stored', 0, '{}', 1, 1)`,
          )
          .run(
            '018f0000-0000-7000-8000-00000000c203',
            'prompt.md',
            '018f0000-0000-7000-8000-00000000c204',
            'schema.json',
          );
        database.client
          .prepare(
            `INSERT INTO experience_research_requests
             (id, brief_json, request_fingerprint, prompt_version, schema_version,
              prompt_file_id, prompt_file_version_no, schema_file_id, schema_file_version_no,
              bundle_file_id, bundle_file_version_no, current_task_id, state, revision,
              created_at, updated_at)
             VALUES (?, '{}', ?, 'community-research-prompt@v1',
                     'community-research-bundle@v1', ?, 1, ?, 1,
                     NULL, NULL, ?, 'ready', 0, 1, 1)`,
          )
          .run(
            requestId,
            'b'.repeat(64),
            '018f0000-0000-7000-8000-00000000c203',
            '018f0000-0000-7000-8000-00000000c204',
            taskId,
          );
      } finally {
        database.close();
      }

      const retried = await command(dataRoot, ['task', 'retry', taskId]);
      expect(retried).toMatchObject({
        exitCode: 0,
        body: {
          ok: true,
          data: {
            kind: 'enqueued',
            task: {
              taskType: 'interview.experience-research.execute',
              status: 'pending',
              retryOfTaskId: taskId,
            },
          },
        },
      });
      const retryTaskId = (retried.body as { data: { task: { id: string } } }).data.task.id;
      const verificationDatabase = openSqliteDatabase({ dataRoot });
      try {
        expect(
          verificationDatabase.client
            .prepare('SELECT current_task_id FROM experience_research_requests WHERE id = ?')
            .pluck()
            .get(requestId),
        ).toBe(retryTaskId);
      } finally {
        verificationDatabase.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it.each([
    {
      label: 'question',
      taskType: 'interview.project-question',
      turnStatus: 'question_pending',
      taskReference: 'question' as const,
    },
    {
      label: 'answer digest',
      taskType: 'interview.project-answer-digest',
      turnStatus: 'digest_pending',
      taskReference: 'digest' as const,
    },
  ])('retries a deep-project $label task and relinks its turn', async (fixture) => {
    const root = await createTemporaryDataRoot('jobhunter-cli-project-task-');
    const dataRoot = path.join(root.path, fixture.label);
    const taskId = parseId('018f0000-0000-7000-8000-00000000c301', 'Task');
    const dossierId = '018f0000-0000-7000-8000-00000000c302';
    const sessionId = '018f0000-0000-7000-8000-00000000c303';
    const turnId = '018f0000-0000-7000-8000-00000000c304';
    const answerRevisionId = '018f0000-0000-7000-8000-00000000c305';
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const database = openSqliteDatabase({ dataRoot });
      try {
        const payload =
          fixture.taskReference === 'question'
            ? {
                dossierId,
                sessionId,
                turnId,
                expectedContextRevision: 0,
                contextHash: 'c'.repeat(64),
              }
            : { dossierId, sessionId, turnId, answerRevisionId };
        new SqliteTaskRepository(database.client).enqueue({
          id: taskId,
          taskType: fixture.taskType,
          payload,
          priority: 0,
          idempotencyKey: `cli-project-${fixture.taskReference}-retry-fixture`,
          concurrencyKey: `interview-session:${sessionId}`,
          scheduleId: null,
          retryOfTaskId: null,
          maxAttempts: 3,
          availableAt: utcInstant(1),
          createdAt: utcInstant(1),
        });
        database.client
          .prepare(
            `INSERT INTO resume_project_snapshots
             (id, source_profile_id, source_profile_version_id, project_index, project_json,
              content_hash, created_at)
             VALUES ('018f0000-0000-7000-8000-00000000c306',
                     '018f0000-0000-7000-8000-00000000c307',
                     '018f0000-0000-7000-8000-00000000c308', 0, '{}', ?, 1)`,
          )
          .run('d'.repeat(64));
        database.client
          .prepare(
            `INSERT INTO project_dossiers
             (id, snapshot_id, notebook_file_id, notebook_source_hash, revision, created_at,
              updated_at)
             VALUES (?, '018f0000-0000-7000-8000-00000000c306', NULL, NULL, 0, 1, 1)`,
          )
          .run(dossierId);
        database.client
          .prepare(
            `INSERT INTO drill_sessions
             (id, dossier_id, profile_key, profile_version, profile_definition_hash,
              capability_summary_json, material_bindings_json, status, context_revision,
              created_at, updated_at, completed_at)
             VALUES (?, ?, 'resume-only', 'v1', ?, ?, '[]', 'active', 0, 1, 1, NULL)`,
          )
          .run(
            sessionId,
            dossierId,
            'e'.repeat(64),
            JSON.stringify({
              evidenceKinds: ['resume_project', 'user_answer', 'derived_claim'],
              tools: [],
            }),
          );
        database.client
          .prepare(
            `INSERT INTO drill_turns
             (id, session_id, turn_no, status, context_hash, question, intent,
              primary_dimension, guidance_slots_json, evidence_refs_json, question_task_id,
              question_agent_run_id, digest_task_id, digest_agent_run_id, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?, NULL, NULL, NULL, '[]', '[]', ?, NULL, ?, NULL, 1, 1)`,
          )
          .run(
            turnId,
            sessionId,
            fixture.turnStatus,
            'c'.repeat(64),
            fixture.taskReference === 'question' ? taskId : null,
            fixture.taskReference === 'digest' ? taskId : null,
          );
        database.client
          .prepare(
            `UPDATE tasks SET status = 'failed', attempt_count = 1, finished_at = 2,
             error_category = 'permanent', error_summary = 'fixture failure' WHERE id = ?`,
          )
          .run(taskId);
      } finally {
        database.close();
      }

      const retried = await command(dataRoot, ['task', 'retry', taskId]);
      expect(retried).toMatchObject({
        exitCode: 0,
        body: {
          ok: true,
          data: {
            kind: 'enqueued',
            task: { taskType: fixture.taskType, retryOfTaskId: taskId },
          },
        },
      });
      const retryTaskId = (retried.body as { data: { task: { id: string } } }).data.task.id;
      const verificationDatabase = openSqliteDatabase({ dataRoot });
      try {
        const references = verificationDatabase.client
          .prepare('SELECT question_task_id, digest_task_id FROM drill_turns WHERE id = ?')
          .get(turnId) as { question_task_id: string | null; digest_task_id: string | null };
        expect(
          fixture.taskReference === 'question'
            ? references.question_task_id
            : references.digest_task_id,
        ).toBe(retryTaskId);
      } finally {
        verificationDatabase.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
