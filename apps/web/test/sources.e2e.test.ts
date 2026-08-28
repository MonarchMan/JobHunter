import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { parseId } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const companyId = '018f0000-0000-7000-8f00-00000000f901';
const channelId = '018f0000-0000-7000-8f00-00000000f902';
const sourceId = '018f0000-0000-7000-8f00-00000000f903';

function seedSource(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    database.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'fixture-tencent', '腾讯', '[]', 1, 1, 1)`,
      )
      .run(companyId);
    database.client
      .prepare(
        `INSERT INTO source_channels
         (id, company_id, channel, slug, enabled, created_at, updated_at)
         VALUES (?, ?, 'intern', 'fixture-tencent-intern', 1, 1, 1)`,
      )
      .run(channelId, companyId);
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, channel_id, slug, adapter_key, coverage_role, recruitment_type, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, 'fixture-tencent-intern', 'fixture.tencent.intern', 'required', 'campus',
          'https://careers.tencent.com', '{}', 'v1', '{}', 1, 'supported', 'healthy',
          0, 2, 1, 2)`,
      )
      .run(sourceId, companyId, channelId);
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

  it('fans one logical channel out to independent physical source tasks', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-channel-fanout-');
    try {
      seedSource(root.path);
      const secondSourceId = '018f0000-0000-7000-8f00-00000000f904';
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        database.client
          .prepare(
            `INSERT INTO job_sources
             (id, company_id, channel_id, slug, adapter_key, coverage_role, recruitment_type,
              base_url, config_json, sync_policy_version, sync_policy_json, enabled,
              support_status, health_status, created_at, updated_at)
             VALUES (?, ?, ?, 'fixture-tencent-intern-second', 'fixture.tencent.intern.second', 'required',
                     'campus', 'https://careers.tencent.com/second', '{}', 'v1', '{}', 1,
                     'supported', 'unknown', 1, 1)`,
          )
          .run(secondSourceId, companyId, channelId);
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
        const result = container.services.webSources.mutateChannel({
          kind: 'sync',
          channelId,
          idempotencyToken: 'fanout-request-token',
        });
        expect(result).toMatchObject({ kind: 'tasks', tasks: [{}, {}] });
        expect(
          container.services.tasks
            .list()
            .map((task) => task.payload)
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        ).toEqual([
          { sourceId, trigger: 'manual' },
          { sourceId: secondSourceId, trigger: 'manual' },
        ]);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('defaults to internship sync and cancels pending work when the active channel changes', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-settings-');
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
        expect(container.services.settings.get()).toEqual({
          jobUnderstanding: { enabled: false },
          sourceSync: { channel: 'intern' },
        });
        container.services.sources.enqueueSync({
          sourceIds: [parseId(sourceId, 'JobSource')],
          idempotencyToken: 'cancel-after-channel-change',
        });
        container.services.webSources.mutate({
          kind: 'schedule',
          sourceId,
          cronExpression: '0 9 * * *',
          timezone: 'Asia/Shanghai',
          enabled: true,
        });
        expect(
          container.services.settings.update({
            jobUnderstandingEnabled: true,
            sourceSyncChannel: 'campus',
          }),
        ).toEqual({
          jobUnderstanding: { enabled: true },
          sourceSync: { channel: 'campus' },
        });
        expect(container.services.tasks.list()[0]?.status).toBe('cancelled');
        expect(
          container.services.webSources.list().find((source) => source.id === sourceId)?.schedule
            ?.enabled,
        ).toBe(false);
        expect(() =>
          container.services.webSources.mutate({
            kind: 'sync',
            sourceId,
            idempotencyToken: 'inactive-intern-source',
          }),
        ).toThrow('当前选择的同步招聘渠道');
        const activeChannelTasks = container.services.sources.enqueueChannelSync({
          channelIds: 'all',
          idempotencyToken: 'all-active-campus-channels',
        });
        expect(activeChannelTasks.length).toBeGreaterThan(0);
        const channelBySource = new Map(
          container.services.sources.list().map((source) => [source.id, source.channel]),
        );
        expect(
          activeChannelTasks.every(
            (result) =>
              channelBySource.get(
                (result.task.payload as { readonly sourceId: string }).sourceId,
              ) === 'campus',
          ),
        ).toBe(true);
        expect(
          container.services.webSources
            .listChannels()
            .filter((channel) => channel.enabled)
            .map((channel) => channel.channel),
        ).toEqual(expect.arrayContaining(['campus']));
        expect(
          container.services.webSources
            .listChannels()
            .filter((channel) => channel.enabled)
            .some((channel) => channel.channel !== 'campus'),
        ).toBe(false);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('reconciles the complete first-party catalog idempotently on startup', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-source-catalog-');
    try {
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const config = resolveAppConfig({ bootstrap, environment: {}, file: {} });
      createLocalWebContainer(config).close();

      const customized = openSqliteDatabase({ dataRoot: root.path });
      try {
        customized.client
          .prepare(
            `UPDATE job_sources
             SET config_json = '{"custom":true}', enabled = 0, health_status = 'unhealthy'
             WHERE id = '018f0000-0000-7000-8000-000000000211'`,
          )
          .run();
        customized.client
          .prepare(
            `INSERT INTO sync_runs
             (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
              sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
             VALUES ('018f0000-0000-7000-8f00-00000000f911',
                     '018f0000-0000-7000-8000-000000000211', 'manual', 'succeeded',
                     'complete', 'v1', 'v1', 'v1', 'preserved', '{}', 1, 2)`,
          )
          .run();
      } finally {
        customized.close();
      }
      createLocalWebContainer(config).close();

      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        expect(database.client.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(15);
        expect(database.client.prepare('SELECT count(*) FROM source_channels').pluck().get()).toBe(
          45,
        );
        expect(database.client.prepare('SELECT count(*) FROM job_sources').pluck().get()).toBe(47);
        expect(
          database.client
            .prepare('SELECT DISTINCT channel FROM source_channels WHERE enabled = 1')
            .pluck()
            .all(),
        ).toEqual(['intern']);
        expect(
          database.client
            .prepare(
              `SELECT config_json, enabled, health_status
               FROM job_sources WHERE id = '018f0000-0000-7000-8000-000000000211'`,
            )
            .get(),
        ).toEqual({ config_json: '{"custom":true}', enabled: 0, health_status: 'unhealthy' });
        expect(
          database.client
            .prepare(
              `SELECT count(*) FROM sync_runs
               WHERE source_id = '018f0000-0000-7000-8000-000000000211'`,
            )
            .pluck()
            .get(),
        ).toBe(1);
      } finally {
        database.close();
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
        expect(
          container.services.webSources.list().find((source) => source.id === sourceId),
        ).toMatchObject({
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
        });
        expect(
          container.services.webSources.listChannels().find((channel) => channel.id === channelId),
        ).toMatchObject({
          id: channelId,
          channel: 'intern',
          supportStatus: 'supported',
          healthStatus: 'healthy',
          sources: [{ id: sourceId, effectiveEnabled: true }],
        });

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
        const channelSync = container.services.webSources.mutateChannel({
          kind: 'sync',
          channelId,
          idempotencyToken: 'channel-request-token',
        });
        expect(channelSync).toMatchObject({
          kind: 'tasks',
          tasks: [{ deduplicated: true }],
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
        const listed = container.services.webSources
          .list()
          .find((source) => source.id === sourceId);
        expect(listed?.enabled).toBe(false);
        expect(Date.parse(listed?.schedule?.nextRunAt ?? '')).toBeGreaterThan(Date.now());
        const disabledChannel = container.services.webSources.mutateChannel({
          kind: 'enable',
          channelId,
          enabled: false,
        });
        expect(disabledChannel).toMatchObject({ kind: 'channel', channel: { enabled: false } });
        expect(() =>
          container.services.sources.enqueueSync({
            sourceIds: [parseId(sourceId, 'JobSource')],
            idempotencyToken: 'disabled-channel-token',
          }),
        ).toThrow('Source is disabled');
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
