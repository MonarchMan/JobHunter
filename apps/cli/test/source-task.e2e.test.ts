import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import path from 'node:path';
import { vi, describe, expect, it } from 'vitest';
import { runLocalCli, type CliIo } from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
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

/** 构造测试输入或执行断言的辅助逻辑。 */
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
            `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES ('018f0000-0000-7000-8000-000000000402', '018f0000-0000-7000-8000-000000000401', 1, ?, ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
          )
          .run(profile, 'a'.repeat(64));
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
  }, 90_000);

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
            `INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,available_at,created_at)
VALUES (?, 'interview.experience-research',json_object('research',json_object(
'request_fingerprint',?,'prompt_hash',?,'prompt_file_id',?,'schema_file_id',?,'current_task_id',?,'state','ready','revision',0)),
'pending','cli-research-parent',253402300799000,1)`,
          )
          .run(
            requestId,
            'b'.repeat(64),
            'c'.repeat(64),
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
              status: 'succeeded',
            },
          },
        },
      });
      const retryTaskId = (retried.body as { data: { task: { id: string } } }).data.task.id;
      expect(retryTaskId).toBe(taskId);
      const verificationDatabase = openSqliteDatabase({ dataRoot });
      try {
        expect(
          verificationDatabase.client
            .prepare(
              `SELECT json_extract(private_state,'$.research.current_task_id') FROM tasks WHERE id=?`,
            )
            .pluck()
            .get(requestId),
        ).toBe(retryTaskId);
      } finally {
        verificationDatabase.close();
      }
    } finally {
      await root.cleanup();
    }
  }, 90_000);
});

// 命令契约测试不启动网络执行器；中央服务真实生命周期由 embedded-tasks 覆盖。
vi.mock(import('@jobhunter/common/task-host-runtime'), async (original) => ({
  ...(await original()),
  ensureConfiguredTaskHost: vi.fn(() => Promise.resolve()),
  allowConfiguredTask: vi.fn(() => Promise.resolve()),
}));

// 命令契约使用合成等待投影，不领取或执行持久任务；真实等待及线程生命周期由 embedded-tasks 覆盖。
vi.mock(import('@jobhunter/recruitment/source-management-service'), async (original) => {
  const actual = await original();
  return {
    ...actual,
    TaskWaitService: class extends actual.TaskWaitService {
      readonly projection: ConstructorParameters<typeof actual.TaskWaitService>[0];
      constructor(...args: ConstructorParameters<typeof actual.TaskWaitService>) {
        super(...args);
        this.projection = args[0];
      }
      override wait(
        taskId: Parameters<InstanceType<typeof actual.TaskWaitService>['wait']>[0],
        signal: AbortSignal,
      ): ReturnType<InstanceType<typeof actual.TaskWaitService>['wait']> {
        signal.throwIfAborted();
        const task = this.projection.get(taskId);
        return Promise.resolve(task ? { ...task, status: 'succeeded' as const } : null);
      }
    },
  };
});
