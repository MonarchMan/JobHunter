import {
  ProfileVersionConflictError,
  resolveAppConfig,
  resolveBootstrapConfig,
} from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { parseId } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const initialProfile = {
  targetRoles: ['Agent 开发工程师'],
  preferences: {
    locations: ['北京'],
    companySizes: ['large'],
    employmentTypes: ['全职'],
    excludedTerms: [],
    remoteAccepted: null,
  },
  education: [],
  workExperience: [
    {
      organization: '示例科技',
      title: '研发实习生',
      startDate: '2025-01-01',
      endDate: '2025-06-30',
      highlights: ['开发任务重试功能'],
      evidence: [{ source: 'resume', quote: '任务重试' }],
    },
  ],
  projects: [
    {
      name: '任务调度系统',
      role: '后端开发',
      startDate: '2025-02-01',
      endDate: '2025-05-31',
      highlights: ['降低失败任务人工处理成本'],
      evidence: [{ source: 'resume', quote: '失败任务处理' }],
    },
  ],
  skills: [
    {
      name: 'TypeScript',
      level: 'proficient',
      evidence: [{ source: 'resume', quote: 'TypeScript' }],
    },
  ],
  domains: ['大模型应用'],
  yearsOfExperience: 3,
  managementExperience: false,
} as const;

function seedProfile(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000601', 'Agent 求职画像', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000602',
          '018f0000-0000-7000-8000-000000000601', 1, ?, ?, '[]', ?, 1, 1)`,
      )
      .run(JSON.stringify(initialProfile), JSON.stringify(initialProfile), '0'.repeat(64));
  } finally {
    database.close();
  }
}

describe('Web profile management', () => {
  it('queues selected resume sections without changing the current profile version', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-profile-polish-');
    try {
      seedProfile(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const profileId = '018f0000-0000-7000-8000-000000000601';
        const sourceVersionId = '018f0000-0000-7000-8000-000000000602';
        expect(() =>
          container.services.resumePolish.enqueue({
            profileId,
            sourceVersionId,
            sections: [],
            idempotencyToken: 'empty-selection',
          }),
        ).toThrow(/至少选择/);
        const accepted = container.services.resumePolish.enqueue({
          profileId,
          sourceVersionId,
          sections: ['projects'],
          idempotencyToken: 'polish-request-one',
        });
        expect(accepted).toMatchObject({
          task: { status: 'pending', deduplicated: false },
        });
        expect(accepted.task.statusUrl).toContain('/api/profile/polish?task=');
        expect(
          container.services.tasks.get(parseId(accepted.task.taskId, 'Task'))?.payload,
        ).toMatchObject({ sections: ['projects'], sourceVersionId });
        expect(container.services.webProfiles.get(profileId).current.id).toBe(sourceVersionId);
        expect(
          container.services.resumePolish.status(accepted.task.taskId, accepted.suggestionId),
        ).toMatchObject({ status: 'pending', suggestion: null });

        const duplicate = container.services.resumePolish.enqueue({
          profileId,
          sourceVersionId,
          sections: ['projects'],
          idempotencyToken: 'polish-request-one',
        });
        expect(duplicate.task.taskId).toBe(accepted.task.taskId);
        expect(duplicate.suggestionId).toBe(accepted.suggestionId);
        expect(duplicate.task.deduplicated).toBe(true);

        const cleared = container.services.webProfiles.mutate({
          kind: 'replace',
          profileId,
          expectedVersionId: sourceVersionId,
          profile: { ...initialProfile, targetRoles: [] },
        });
        expect(() =>
          container.services.resumePolish.enqueue({
            profileId,
            sourceVersionId: cleared.current.id,
            sections: ['projects'],
            idempotencyToken: 'missing-target-role',
          }),
        ).toThrow(/确认目标岗位/);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('versions corrections, preferences and locks with optimistic concurrency', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-profile-');
    try {
      seedProfile(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const profileId = '018f0000-0000-7000-8000-000000000601';
        const original = container.services.webProfiles.get(profileId);
        expect(original).toMatchObject({
          profile: { name: 'Agent 求职画像' },
          current: {
            versionNumber: 1,
            extracted: { preferences: { locations: ['北京'] } },
            effective: { preferences: { locations: ['北京'] } },
            lockedPaths: [],
          },
        });

        const preferences = container.services.webProfiles.mutate({
          kind: 'preferences',
          profileId,
          expectedVersionId: original.current.id,
          preferences: {
            ...original.current.effective.preferences,
            locations: ['上海', '杭州'],
            remoteAccepted: true,
          },
        });
        expect(preferences.current).toMatchObject({
          versionNumber: 2,
          effective: { preferences: { locations: ['上海', '杭州'], remoteAccepted: true } },
        });
        expect(preferences.current.extracted.preferences.locations).toEqual(['北京']);

        const replaced = container.services.webProfiles.mutate({
          kind: 'replace',
          profileId,
          expectedVersionId: preferences.current.id,
          profile: {
            ...preferences.current.effective,
            basicInfo: {
              name: '候选人',
              phone: '13800000000',
              email: 'candidate@example.com',
              location: '上海',
              website: 'https://example.com',
            },
            works: [{ name: 'Agent 作品', description: '在线演示', url: 'https://example.com' }],
            competitions: [{ name: '创新竞赛', award: '一等奖', date: '2026-06' }],
            certificates: [{ name: '云计算证书', issuer: '测试机构', date: '2026-05' }],
            languages: [{ name: '英语', proficiency: 'CET-6' }],
            professionalSkills: '熟练使用 TypeScript 与 React。',
            selfEvaluation: '重视交付质量。',
          },
        });
        expect(replaced.current).toMatchObject({
          versionNumber: 3,
          effective: {
            basicInfo: { name: '候选人' },
            works: [{ name: 'Agent 作品' }],
            languages: [{ name: '英语', proficiency: 'CET-6' }],
            professionalSkills: '熟练使用 TypeScript 与 React。',
            selfEvaluation: '重视交付质量。',
          },
        });

        expect(() =>
          container.services.webProfiles.mutate({
            kind: 'lock',
            profileId,
            expectedVersionId: preferences.current.id,
            pointer: '/preferences/locations',
          }),
        ).toThrow(ProfileVersionConflictError);

        const locked = container.services.webProfiles.mutate({
          kind: 'lock',
          profileId,
          expectedVersionId: replaced.current.id,
          pointer: '/preferences/locations',
        });
        expect(locked.current.lockedPaths).toEqual(['/preferences/locations']);

        const corrected = container.services.webProfiles.mutate({
          kind: 'set',
          profileId,
          expectedVersionId: locked.current.id,
          pointer: '/targetRoles',
          value: ['大模型应用工程师'],
        });
        expect(corrected.current.effective.targetRoles).toEqual(['大模型应用工程师']);
        expect(corrected.versions.map((version) => version.versionNumber)).toEqual([5, 4, 3, 2, 1]);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
