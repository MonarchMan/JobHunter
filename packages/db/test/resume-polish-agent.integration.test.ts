import { AgentRunner } from '@jobhunter/agent-core';
import {
  createResumePolishTaskHandler,
  type TaskHandlerContext,
  type TaskLogger,
} from '@jobhunter/application';
import { utcInstant } from '@jobhunter/domain';
import { FakeModelClient } from '@jobhunter/llm';
import { createTemporaryDataRoot, makeCandidateProfile } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteResumePolishSuggestionRepository,
} from '../src/index.js';

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
          'b'.repeat(64),
        );

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
      const suggestions = new SqliteResumePolishSuggestionRepository(database.client);
      const handler = createResumePolishTaskHandler({
        runner,
        profiles: new SqliteCandidateProfileRepository(database.client),
        suggestions,
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
      expect(suggestions.get(suggestionId)).toMatchObject({
        profileId,
        sourceVersionId: versionId,
        sections: ['projects'],
        result: {
          workExperience: null,
          projects: [['实现失败任务重试机制，减少人工处理。']],
        },
      });
    } finally {
      database.close();
      await root.cleanup();
    }
  });
});
