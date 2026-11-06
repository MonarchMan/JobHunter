import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const resumeId = '018f0000-0000-7000-8000-000000000801';

/** 构造测试输入或执行断言的辅助逻辑。 */
function seedResume(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  const profile = JSON.stringify(makeCandidateProfile());
  try {
    database.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES ('018f0000-0000-7000-8000-000000000802',
          'artifacts/test-resume', 'text/plain', ?, 8, 1, NULL)`,
      )
      .run('a'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'resume', 'test-resume.txt', 'parsed', 0, '{}', 1, 1)`,
      )
      .run(resumeId);
    database.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
          metadata_json, created_at)
         VALUES (?, '018f0000-0000-7000-8000-000000000802', 1, 'test-v1', 'parsed',
          'private resume text', '{}', 1)`,
      )
      .run(resumeId);
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000803', 'Test', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `WITH profile_input (id, profile_id, version_no, resume_file_id, profile_json, content_hash, is_current, created_at) AS (VALUES ('018f0000-0000-7000-8000-000000000804', '018f0000-0000-7000-8000-000000000803', 1, ?, ?, ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,resume_file_id,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,resume_file_id,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(resumeId, profile, 'b'.repeat(64));
  } finally {
    database.close();
  }
}

describe('Web resume deletion', () => {
  it('requires a stable preview before idempotently enqueueing deletion', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-resume-delete-');
    try {
      seedResume(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        const impact = container.services.resumeDeletion.preview(resumeId);
        expect(impact).toMatchObject({
          resumeDocumentId: resumeId,
          counts: { profiles: 1, profileVersions: 1, resumeDocuments: 1, artifacts: 1 },
        });
        expect(JSON.stringify(impact)).not.toContain('private resume text');
        const command = {
          resumeDocumentId: resumeId,
          expectedImpactHash: impact.impactHash,
          confirmation: 'DELETE' as const,
          idempotencyToken: 'deletion-request-token',
        };
        const first = container.services.resumeDeletion.confirm(command);
        const second = container.services.resumeDeletion.confirm(command);
        expect(first).toMatchObject({ deduplicated: false, status: 'pending' });
        expect(second).toMatchObject({ taskId: first.taskId, deduplicated: true });
        expect(container.services.diagnostics.getTask(first.taskId)?.taskType).toBe(
          'resume.delete.confirmed',
        );
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
