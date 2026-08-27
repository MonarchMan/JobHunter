import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const companyId = '018f0000-0000-7000-8000-000000000101';
const sourceId = '018f0000-0000-7000-8000-000000000201';

function seedSource(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    database.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'tencent', '腾讯', '[]', 1, 1, 1)`,
      )
      .run(companyId);
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, slug, adapter_key, recruitment_type, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, last_success_at, created_at, updated_at)
         VALUES (?, ?, 'tencent-social', 'tencent.social', 'social',
          'https://careers.tencent.com', '{}', 'v1', '{}', 1, 'supported', 'healthy',
          0, 2, 1, 2)`,
      )
      .run(sourceId, companyId);
    database.client
      .prepare(
        `INSERT INTO sync_runs
         (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
          sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
         VALUES ('018f0000-0000-7000-8000-000000000301', ?, 'manual', 'succeeded',
          'complete', 'v1', 'v1', 'v1', 'hash', '{"created":3,"updated":1}', 1, 2)`,
      )
      .run(sourceId);
    const profile = JSON.stringify({
      basicInfo: { name: null, phone: null, email: null, location: null, website: null },
      targetRoles: ['大模型应用开发'],
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
}

describe('Web source management', () => {
  it('requires a confirmed target role before queueing source sync', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-source-readiness-');
    try {
      seedSource(root.path);
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        database.client.prepare('DELETE FROM profile_versions').run();
        database.client.prepare('DELETE FROM candidate_profiles').run();
      } finally {
        database.close();
      }
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        expect(container.services.sources.isSyncReady()).toBe(false);
        expect(() =>
          container.services.webSources.mutate({
            kind: 'sync',
            sourceId,
            idempotencyToken: 'blocked-request',
          }),
        ).toThrow('请先在个人资料中确认目标岗位');
        expect(container.services.tasks.list()).toEqual([]);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('reads and updates system settings without removing existing work', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-settings-');
    try {
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        expect(container.services.settings.get()).toEqual({
          jobUnderstanding: { enabled: false },
        });
        expect(container.services.settings.update({ jobUnderstandingEnabled: true })).toEqual({
          jobUnderstanding: { enabled: true },
        });
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('projects source state and persists idempotent actions and schedules', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-sources-');
    try {
      seedSource(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        expect(container.services.webSources.list()).toMatchObject([
          {
            id: sourceId,
            companyName: '腾讯',
            enabled: true,
            healthStatus: 'healthy',
            lastSuccessAt: new Date(2).toISOString(),
            latestRun: {
              status: 'succeeded',
              coverage: 'complete',
              stats: { created: 3, updated: 1 },
            },
            schedule: null,
          },
        ]);

        const syncInput = {
          kind: 'sync' as const,
          sourceId,
          idempotencyToken: 'same-request-token',
        };
        const firstSync = container.services.webSources.mutate(syncInput);
        const secondSync = container.services.webSources.mutate(syncInput);
        expect(firstSync).toMatchObject({ kind: 'task', task: { deduplicated: false } });
        expect(secondSync).toMatchObject({
          kind: 'task',
          task: {
            taskId: firstSync.kind === 'task' ? firstSync.task.taskId : '',
            deduplicated: true,
          },
        });

        const health = container.services.webSources.mutate({
          kind: 'health',
          sourceId,
          idempotencyToken: 'health-request-token',
        });
        expect(health).toMatchObject({ kind: 'task', task: { deduplicated: false } });
        expect(
          container.services.tasks
            .list()
            .map((task) => task.taskType)
            .sort(),
        ).toEqual(['source.health-check', 'source.sync']);

        const disabled = container.services.webSources.mutate({
          kind: 'enable',
          sourceId,
          enabled: false,
        });
        expect(disabled).toMatchObject({ kind: 'source', source: { enabled: false } });

        const scheduled = container.services.webSources.mutate({
          kind: 'schedule',
          sourceId,
          cronExpression: '0 9 * * *',
          timezone: 'Asia/Shanghai',
          enabled: true,
        });
        expect(scheduled).toMatchObject({
          kind: 'source',
          source: {
            schedule: {
              cronExpression: '0 9 * * *',
              timezone: 'Asia/Shanghai',
              enabled: true,
            },
          },
        });
        const listed = container.services.webSources.list()[0];
        expect(listed?.enabled).toBe(false);
        expect(Date.parse(listed?.schedule?.nextRunAt ?? '')).toBeGreaterThan(Date.now());
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
