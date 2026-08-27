import { openSqliteDatabase, SqliteResumePolishSuggestionRepository } from '../src/index.js';
import { createTemporaryDataRoot, makeCandidateProfile } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';

describe('resume polish suggestion persistence', () => {
  it('stores validated suggestions separately from profile versions', async () => {
    const root = await createTemporaryDataRoot('jobhunter-resume-polish-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    try {
      const profileId = '018f0000-0000-7000-8000-000000000701';
      const versionId = '018f0000-0000-7000-8000-000000000702';
      const agentRunId = '018f0000-0000-7000-8000-000000000703';
      const suggestionId = '018f0000-0000-7000-8000-000000000704';
      const profile = makeCandidateProfile();
      database.client
        .prepare(
          `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
           VALUES (?, '测试画像', 1, 1)`,
        )
        .run(profileId);
      database.client
        .prepare(
          `INSERT INTO agent_runs
           (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
            cache_key, status, output_json, started_at, finished_at)
           VALUES (?, 'resume-polish', '1.0.0', 'v1', 'config', 'input', 'cache',
            'succeeded', '{}', 1, 2)`,
        )
        .run(agentRunId);
      database.client
        .prepare(
          `INSERT INTO profile_versions
           (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
            content_hash, is_current, created_at)
           VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
        )
        .run(
          versionId,
          profileId,
          JSON.stringify(profile),
          JSON.stringify(profile),
          'a'.repeat(64),
        );

      const repository = new SqliteResumePolishSuggestionRepository(database.client);
      repository.save({
        id: suggestionId,
        profileId,
        sourceVersionId: versionId,
        sections: ['projects'],
        result: { workExperience: null, projects: [['突出已有项目结果。']] },
        agentRunId,
        createdAt: 3,
      });

      expect(repository.get(suggestionId)).toEqual({
        id: suggestionId,
        profileId,
        sourceVersionId: versionId,
        sections: ['projects'],
        result: { workExperience: null, projects: [['突出已有项目结果。']] },
        agentRunId,
        createdAt: 3,
      });
      expect(
        database.client
          .prepare('SELECT count(*) FROM profile_versions WHERE profile_id = ?')
          .pluck()
          .get(profileId),
      ).toBe(1);
    } finally {
      database.close();
      await root.cleanup();
    }
  });
});
