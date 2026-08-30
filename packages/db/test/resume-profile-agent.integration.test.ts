import { AgentRunner, ModelClientError, type ModelRequest } from '@jobhunter/agent-core';
import {
  CandidateProfileService,
  createResumeProfileTaskHandler,
  type TaskHandlerContext,
  type TaskLogger,
  type TaskExecutionError,
} from '@jobhunter/application';
import { utcInstant, type Clock, type IdGenerator, type UtcInstant } from '@jobhunter/domain';
import { FakeModelClient } from '@jobhunter/llm';
import type { ResumeArtifactReader } from '@jobhunter/application';
import type { ResumeOcrEngine } from '@jobhunter/resume';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteResumeDocumentRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class AdvancingClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    this.#value += 1;
    return utcInstant(this.#value);
  }
}

class SequentialIds implements IdGenerator {
  #counter = 0xa000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

const silentLogger: TaskLogger = {
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

const resources: {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}[] = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

const documentId = '018f0000-0000-7000-8000-00000000b002';
const resumeText =
  '项目经历：Coding Agent。使用 ReAct 推理循环、MCP 工具延迟加载和上下文压缩，实现多 Agent 协作。' +
  '智能云盘项目使用 RAG、RRF 与 Reranker Fusion，提高知识检索质量。'.repeat(3);
const structuredResumeText = `求职意向
后端研发
教育经历
示例大学 | 本科 | 软件工程 | 2019.09-2023.06
项目经历
任务调度系统 | 后端负责人 | 2023.01-2023.06
- 设计任务状态机与幂等执行机制
- 实现任务失败后的指数退避重试
专业技能
编程语言：TypeScript、Python`;

function evidence(text: string, value: string): { start: number; end: number; summary: string } {
  const start = text.indexOf(value);
  if (start < 0) throw new TypeError(`Fixture evidence not found: ${value}.`);
  return { start, end: start + value.length, summary: value };
}

function modelOutput(request: ModelRequest): unknown {
  const parsed = request.input as { readonly extractedText: string };
  const text = parsed.extractedText;
  return {
    targetRoles: [
      { value: 'Agent 开发', confidence: 0.95, evidenceRefs: [evidence(text, 'Coding Agent')] },
    ],
    education: [],
    workExperience: [],
    projects: [
      {
        name: 'Coding Agent',
        role: null,
        startDate: null,
        endDate: null,
        highlights: [
          {
            value: '实现 ReAct 推理循环',
            confidence: 0.95,
            evidenceRefs: [evidence(text, 'ReAct')],
          },
        ],
        evidenceRefs: [evidence(text, 'Coding Agent')],
      },
    ],
    skills: [
      {
        value: { name: 'ReAct', level: 'proficient' },
        confidence: 0.95,
        evidenceRefs: [evidence(text, 'ReAct')],
      },
      {
        value: { name: 'RAG', level: 'proficient' },
        confidence: 0.9,
        evidenceRefs: [evidence(text, 'RAG')],
      },
    ],
    domains: [
      { value: '大模型应用', confidence: 0.9, evidenceRefs: [evidence(text, 'Coding Agent')] },
    ],
    yearsOfExperience: null,
    managementExperience: null,
  };
}

async function setup(
  model: FakeModelClient,
  options: {
    readonly image?: boolean;
    readonly text?: string;
    readonly withoutRunner?: boolean;
  } = {},
): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly profiles: CandidateProfileService;
  readonly handler: ReturnType<typeof createResumeProfileTaskHandler>;
  readonly context: TaskHandlerContext;
}> {
  const root = await createTemporaryDataRoot('jobhunter-resume-agent-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const ids = new SequentialIds();
  const clock = new AdvancingClock();
  const documentText = options.text ?? resumeText;
  handle.client
    .prepare(
      `INSERT INTO entities
       (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
       VALUES ('018f0000-0000-7000-8000-00000000b001', 'artifacts/resume-agent',
               ?, ?, ?, 1, NULL)`,
    )
    .run(options.image ? 'image/jpeg' : 'text/plain', 'd'.repeat(64), documentText.length);
  handle.client
    .prepare(
      `INSERT INTO files
       (id, kind, name, state, revision, properties_json, created_at, updated_at)
       VALUES (?, 'resume', 'resume-agent-fixture', ?, 0, '{}', 1, 1)`,
    )
    .run(documentId, options.image ? 'needs_ocr' : 'parsed');
  handle.client
    .prepare(
      `INSERT INTO file_entity_mappings
       (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
        error_summary, metadata_json, created_at)
       VALUES (?, '018f0000-0000-7000-8000-00000000b001', 1, ?, ?, ?, ?, '{}', 1)`,
    )
    .run(
      documentId,
      options.image ? 'image-needs-ocr@1' : 'utf8@1',
      options.image ? 'needs_ocr' : 'parsed',
      options.image ? null : documentText,
      options.image ? 'Resume image requires background OCR.' : null,
    );
  const profiles = new CandidateProfileService({
    repository: new SqliteCandidateProfileRepository(handle.client),
    clock,
    ids,
  });
  const runner = new AgentRunner({
    store: new SqliteAgentRunStore(handle.client),
    model,
    createId: () => ids.generate(),
    now: () => clock.now(),
  });
  const ocrEngine: ResumeOcrEngine = {
    recognize: () =>
      Promise.resolve({
        text: documentText,
        characterCount: documentText.length,
        engineVersion: 'fake-ocr@1',
      }),
  };
  const artifacts: ResumeArtifactReader = {
    read: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
  };
  return {
    handle,
    profiles,
    handler: createResumeProfileTaskHandler({
      ...(options.withoutRunner ? {} : { runner }),
      documents: new SqliteResumeDocumentRepository(handle.client),
      profiles,
      ...(options.image ? { ocr: { engine: ocrEngine, artifacts } } : {}),
    }),
    context: {
      signal: new AbortController().signal,
      clock,
      logger: silentLogger,
      services: {},
    },
  };
}

describe('resume profile Agent pipeline', () => {
  it('passes only extracted text, validates evidence and creates a versioned profile', async () => {
    const model = new FakeModelClient([
      (request) => ({
        kind: 'output',
        output: modelOutput(request),
        usage: { inputTokens: 100, outputTokens: 80, estimatedCostMicros: 20 },
      }),
    ]);
    const { handle, profiles, handler, context } = await setup(model);
    const profile = profiles.createProfile('脱敏候选人');
    const result = await handler.execute(context, {
      profileId: profile.id,
      resumeDocumentId: documentId,
      expectedCurrentVersionId: null,
    });

    expect(result.cacheHit).toBe(false);
    expect(result.extractionMethod).toBe('llm');
    expect(profiles.getCurrent(profile.id)?.effective).toMatchObject({
      targetRoles: ['Agent 开发'],
      skills: [{ name: 'ReAct' }, { name: 'RAG' }],
    });
    expect(model.requests[0]?.input).toEqual({ extractedText: resumeText });
    expect(Object.keys(model.requests[0] ?? {}).sort()).not.toContain('resumeDocumentId');
    const persistedRun = JSON.stringify(
      handle.client.prepare('SELECT input_hash, output_json, error_summary FROM agent_runs').get(),
    );
    expect(persistedRun).not.toContain(resumeText);
    expect(persistedRun).not.toContain('resume-agent');
  });

  it('uses deterministic rules without creating an AgentRun when sections are clear', async () => {
    const model = new FakeModelClient([]);
    const { handle, profiles, handler, context } = await setup(model, {
      text: structuredResumeText,
      withoutRunner: true,
    });
    const profile = profiles.createProfile('规则提取候选人');
    const result = await handler.execute(context, {
      profileId: profile.id,
      resumeDocumentId: documentId,
      expectedCurrentVersionId: null,
    });

    expect(result).toMatchObject({ extractionMethod: 'rules', agentRunId: null, cacheHit: false });
    expect(profiles.getCurrent(profile.id)).toMatchObject({
      agentRunId: null,
      effective: {
        targetRoles: ['后端研发'],
        projects: [{ name: '任务调度系统', role: '后端负责人' }],
        skills: [{ name: 'TypeScript' }, { name: 'Python' }],
      },
    });
    expect(model.requests).toHaveLength(0);
    expect(handle.client.prepare('SELECT count(*) FROM agent_runs').pluck().get()).toBe(0);
  });

  it('runs OCR and then uses deterministic rules without a configured model', async () => {
    const { handle, profiles, handler, context } = await setup(new FakeModelClient([]), {
      image: true,
      text: structuredResumeText,
      withoutRunner: true,
    });
    const profile = profiles.createProfile('图片规则提取候选人');
    const result = await handler.execute(context, {
      profileId: profile.id,
      resumeDocumentId: documentId,
      expectedCurrentVersionId: null,
    });

    expect(result.extractionMethod).toBe('rules');
    expect(profiles.getCurrent(profile.id)?.effective.projects[0]?.name).toBe('任务调度系统');
    expect(
      handle.client.prepare('SELECT parse_status, parser_version FROM file_entity_mappings').get(),
    ).toEqual({ parse_status: 'parsed', parser_version: 'fake-ocr@1' });
    expect(handle.client.prepare('SELECT count(*) FROM agent_runs').pluck().get()).toBe(0);
  });

  it('does not create a profile version when output remains invalid after one repair', async () => {
    const invalid = {
      kind: 'output' as const,
      output: { skills: 'not-an-array' },
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostMicros: 0 },
    };
    const { handle, profiles, handler, context } = await setup(
      new FakeModelClient([invalid, invalid]),
    );
    const profile = profiles.createProfile('候选人');
    await expect(
      handler.execute(context, {
        profileId: profile.id,
        resumeDocumentId: documentId,
        expectedCurrentVersionId: null,
      }),
    ).rejects.toMatchObject({
      category: 'validation_failed',
    } satisfies Partial<TaskExecutionError>);
    expect(handle.client.prepare('SELECT count(*) FROM profile_versions').pluck().get()).toBe(0);
    expect(handle.client.prepare('SELECT status, error_category FROM agent_runs').get()).toEqual({
      status: 'failed',
      error_category: 'invalid_output',
    });
  });

  it('runs OCR for an image document before reusing the profile Agent pipeline', async () => {
    const model = new FakeModelClient([
      (request) => ({
        kind: 'output',
        output: modelOutput(request),
        usage: { inputTokens: 100, outputTokens: 80, estimatedCostMicros: 20 },
      }),
    ]);
    const { handle, profiles, handler, context } = await setup(model, { image: true });
    const profile = profiles.createProfile('图片简历候选人');
    await handler.execute(context, {
      profileId: profile.id,
      resumeDocumentId: documentId,
      expectedCurrentVersionId: null,
    });

    expect(profiles.getCurrent(profile.id)?.effective).toMatchObject({
      targetRoles: ['Agent 开发'],
      projects: [{ name: 'Coding Agent' }],
    });
    expect(
      handle.client.prepare('SELECT parse_status, parser_version FROM file_entity_mappings').get(),
    ).toEqual({ parse_status: 'parsed', parser_version: 'fake-ocr@1' });
    expect(model.requests[0]?.input).toEqual({ extractedText: resumeText });
  });

  it('maps model rate limits to a retryable Worker task category', async () => {
    const { profiles, handler, context } = await setup(
      new FakeModelClient([new ModelClientError('rate_limited', 'secret provider detail', true)]),
    );
    const profile = profiles.createProfile('候选人');
    await expect(
      handler.execute(context, {
        profileId: profile.id,
        resumeDocumentId: documentId,
        expectedCurrentVersionId: null,
      }),
    ).rejects.toMatchObject({
      category: 'rate_limited',
      safeSummary: 'Resume profile Agent was rate limited.',
    });
  });
});
