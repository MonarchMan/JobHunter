import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { SqliteResumePolishSuggestionStore } from '@jobhunter/user/persistence/resume-polish-suggestion-store';
import { AgentRunner } from '@jobhunter/common/agent';
import { createResumePolishTaskHandler } from '@jobhunter/user/profile';
import type { TaskHandlerContext, TaskLogger } from '@jobhunter/common/tasks';
import { utcInstant } from '@jobhunter/common/domain';
import { FakeModelClient } from '@jobhunter/common/models';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';

const logger: TaskLogger = {
  info(event, fields): void {
    void event;
    void fields;
  },
  warn(event, fields): void {
    void event;
    void fields;
  },
  error(event, fields): void {
    void event;
    void fields;
  },
};

describe('resume polish Agent task', () => {
  it('sends only selected sections and persists a reviewable suggestion', async () => {
    const root = await createTemporaryDataRoot('jobhunter-resume-polish-agent-');
    const database = openSqliteDatabase({ dataRoot: root.path });
    try {
      const profileId = '018f0000-0000-7000-8000-000000000721';
      const versionId = '018f0000-0000-7000-8000-000000000722';
      const suggestionId = '018f0000-0000-7000-8000-000000000723';
      const runId = '018f0000-0000-7000-8000-000000000724';
      const profile = makeCandidateProfile({
        targetRoles: ['研发'],
        workExperience: [
          {
            organization: '示例科技',
            title: '研发实习生',
            startDate: null,
            endDate: null,
            highlights: ['维护内部平台'],
            evidence: [{ source: 'resume', quote: '维护内部平台' }],
          },
        ],
        projects: [
          {
            name: '任务调度系统',
            role: '后端开发',
            startDate: null,
            endDate: null,
            highlights: ['开发失败重试功能'],
            evidence: [{ source: 'resume', quote: '失败重试' }],
          },
        ],
      });
      database.client
        .prepare(
          `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
           VALUES (?, '研发画像', 1, 1)`,
        )
        .run(profileId);
      database.client
        .prepare(
          `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, ?, ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
        )
        .run(versionId, profileId, JSON.stringify(profile), 'b'.repeat(64));

      const model = new FakeModelClient([
        {
          kind: 'output',
          output: {
            workExperience: null,
            projects: [['实现失败任务重试机制，减少人工处理。']],
          },
          usage: { inputTokens: 20, outputTokens: 10, estimatedCostMicros: 30 },
        },
      ]);
      const runner = new AgentRunner({
        store: new SqliteAgentRunStore(database.client),
        model,
        createId: () => runId,
        now: () => 10,
      });
      const runStore = new SqliteAgentRunStore(database.client);
      const handler = createResumePolishTaskHandler({
        runner,
        suggestions: new SqliteResumePolishSuggestionStore(database.client),
        profiles: new SqliteCandidateProfileRepository(
          database.client,
          new SqliteProfileDerivedDataManager(database.client),
        ),
      });
      const context: TaskHandlerContext = {
        signal: new AbortController().signal,
        clock: { now: () => utcInstant(20) },
        logger,
        services: {},
      };

      await expect(
        handler.execute(context, {
          suggestionId,
          profileId,
          sourceVersionId: versionId,
          sections: ['projects'],
        }),
      ).resolves.toMatchObject({ suggestionId, agentRunId: runId });

      expect(model.requests[0]?.input).toMatchObject({
        targetRole: '研发',
        selectedSections: ['projects'],
        workExperience: null,
        projects: [{ name: '任务调度系统', highlights: ['开发失败重试功能'] }],
      });
      expect(runStore.get(runId)).toMatchObject({
        status: 'succeeded',
        output: null,
      });
      expect(
        new SqliteResumePolishSuggestionStore(database.client).get(suggestionId),
      ).toMatchObject({ projects: [['实现失败任务重试机制，减少人工处理。']] });
      expect(
        database.client
          .prepare("SELECT count(*) FROM sqlite_master WHERE name = 'resume_polish_suggestions'")
          .pluck()
          .get(),
      ).toBe(1);
    } finally {
      database.close();
      await root.cleanup();
    }
  });
});
