import {
  ProfileVersionConflictError,
  resolveAppConfig,
  resolveBootstrapConfig,
} from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
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
  workExperience: [],
  projects: [],
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

        expect(() =>
          container.services.webProfiles.mutate({
            kind: 'lock',
            profileId,
            expectedVersionId: original.current.id,
            pointer: '/preferences/locations',
          }),
        ).toThrow(ProfileVersionConflictError);

        const locked = container.services.webProfiles.mutate({
          kind: 'lock',
          profileId,
          expectedVersionId: preferences.current.id,
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
        expect(corrected.versions.map((version) => version.versionNumber)).toEqual([4, 3, 2, 1]);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
