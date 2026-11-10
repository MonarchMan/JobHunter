import { it, expect } from 'vitest';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import { HandlerRegistry, TaskService } from '@jobhunter/common/tasks';
import { SqliteAiSessionRepository } from '../src/persistence/ai-session-repository.js';
import { SqliteCandidateProfileRepository } from '../src/persistence/sqlite-candidate-profile-repository.js';
import { AiSessionService } from '../src/ai/service.js';
import { createAiReplyHandler } from '../src/ai/handler.js';
import { CandidateProfileService } from '../src/profile/candidate-profile-service.js';
import { parseCandidateProfile } from '../src/domain/profile/profile.js';
import { AgentRunner } from '@jobhunter/common/agent';
import { OpenAiCompatibleModelClient } from '@jobhunter/common/models';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';

it('keeps conversations after project deletion, rejects stale replies and overwrites answers without revisions', async () => {
  const root = await createTemporaryDataRoot('ai-sessions-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    const clock = { now: () => utcInstant(Date.now()) };
    const ids = new SystemIdGenerator();
    const profiles = new SqliteCandidateProfileRepository(db.client, {
      deleteMatchesForVersions: () => undefined,
      matchResultIds: () => [],
      adviceAgentRunIds: () => [],
      deleteMatchResults: () => undefined,
      hasAgentRunReferences: () => false,
    });
    const profileService = new CandidateProfileService({ repository: profiles, clock, ids });
    const profile = profileService.createProfile('Test');
    // 人工创建初始版本，无需简历文件或外部模型。
    const effective = parseCandidateProfile({
      targetRoles: [],
      preferences: {
        locations: [],
        companySizes: [],
        employmentTypes: [],
        excludedTerms: [],
        remoteAccepted: null,
      },
      education: [],
      workExperience: [],
      projects: [
        {
          id: 'project-1',
          local_path: '/missing/project',
          name: '项目',
          role: null,
          startDate: null,
          endDate: null,
          highlights: ['开发'],
          evidence: [],
        },
      ],
      domains: [],
      yearsOfExperience: null,
      managementExperience: null,
    });
    profiles.appendVersion({
      expectedCurrentVersionId: null,
      version: {
        id: ids.generate() as never,
        profileId: profile.id,
        versionNo: 1,
        resumeDocumentId: null,
        agentRunId: null,
        effective,
        contentHash: 'a'.repeat(64) as never,
        isCurrent: true,
        isCandidate: false,
        baseVersionId: null,
        createdAt: clock.now(),
      },
    });
    const registry = new HandlerRegistry();
    expect(createAiReplyHandler({}).defaultMaxAttempts).toBe(1);
    registry.register(createAiReplyHandler({}));
    const tasks = new TaskService(
      { queue: new SqliteTaskRepository(db.client), clock, ids },
      registry,
    );
    const repository = new SqliteAiSessionRepository(db.client);
    const service = new AiSessionService({ repository, profiles, tasks, clock, ids });
    const session = service.create({
      type: 'interview',
      title: '模拟面试',
      profileId: profile.id,
      projectId: 'project-1',
    });
    const reply = service.send(session.id, '原回答');
    const before = service.context(session.id, reply.id);
    expect(JSON.stringify(before.value)).not.toContain('/missing');
    const user = service.detail(session.id).messages[0];
    if (!user) throw new Error('Expected user message');
    service.edit(session.id, user.id, '修改后的回答', user.updatedAt);
    expect(service.complete(session.id, reply.id, before.hash, '迟到回复')).toBe(false);
    expect(JSON.stringify(service.detail(session.id))).not.toContain('原回答');
    const second = service.send(session.id, '继续');
    const snapshot = service.context(session.id, second.id);
    expect(service.complete(session.id, second.id, snapshot.hash, '好的，请说明项目的设计。')).toBe(
      true,
    );
    const current = profiles.getCurrentVersion(profile.id);
    if (!current) throw new Error('Expected current profile');
    profileService.applyManualCorrection({
      profileId: profile.id,
      expectedCurrentVersionId: current.id,
      patch: { projects: [] },
    });
    expect(service.detail(session.id).metadata.project_id).toBeUndefined();
    const third = service.send(session.id, '项目已删除，继续日常对话');
    expect(service.context(session.id, third.id).value.project).toBeNull();
    expect(service.detail(session.id).messages).toHaveLength(6);
    const runner = new AgentRunner({
      store: new SqliteAgentRunStore(db.client),
      createId: () => ids.generate(),
      now: () => clock.now(),
      model: new OpenAiCompatibleModelClient({
        baseUrl: 'https://fixture.test/v1',
        apiKey: 'fixture',
        model: 'fixture',
        fetchImplementation: () =>
          Promise.resolve(
            Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ content: '可以继续，请说明你希望讨论的问题。' }),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 20 },
            }),
          ),
      }),
    });
    const handler = createAiReplyHandler({ service, runner });
    const context = {
      clock,
      signal: new AbortController().signal,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      services: {},
    };
    await handler.execute(context, { sessionId: session.id, messageId: third.id });
    expect(service.detail(session.id).messages.at(-1)).toMatchObject({
      status: 'completed',
      content: '可以继续，请说明你希望讨论的问题。',
    });
    expect(db.client.prepare('SELECT ai_message_id FROM model_requests').pluck().all()).toEqual([
      third.id,
    ]);
    expect(
      db.client
        .prepare("SELECT output_json FROM agent_runs WHERE agent_key='ai.reply'")
        .pluck()
        .get(),
    ).toBeNull();
    // 执行进程意外结束导致任务失败时，消息查询应解除“生成中”，允许继续对话。
    const orphan = service.send(session.id, '任务执行器崩溃场景');
    db.client
      .prepare("UPDATE tasks SET status='failed' WHERE idempotency_key=?")
      .run(`ai.reply:${orphan.id}`);
    expect(service.detail(session.id).messages.at(-1)?.status).toBe('failed');
    expect(() => service.send(session.id, '新一轮对话')).not.toThrow();
    db.client.prepare('DELETE FROM candidate_profiles WHERE id=?').run(profile.id);
    expect(service.detail(session.id).metadata).toEqual({});
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    await root.cleanup();
  }
});
