import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { makeCandidateProfile, FakeModel } from '@jobhunter/testkit';
import { openSqliteDatabase } from '@jobhunter/db';
import {
  contentHash,
  drillCoverageDimensions,
  parseNormalizedJob,
  type CandidateProfileData,
  type NormalizedJob,
} from '@jobhunter/domain';

const ids = {
  company: '018f0000-0000-7000-8f00-000000000101',
  channel: '018f0000-0000-7000-8f00-000000000102',
  source: '018f0000-0000-7000-8f00-000000000201',
  syncRun: '018f0000-0000-7000-8000-000000000301',
  activeJob: '018f0000-0000-7000-8000-000000000401',
  staleJob: '018f0000-0000-7000-8000-000000000402',
  closedJob: '018f0000-0000-7000-8000-000000000403',
  activeRaw: '018f0000-0000-7000-8000-000000000501',
  staleRaw: '018f0000-0000-7000-8000-000000000502',
  activeRevision: '018f0000-0000-7000-8000-000000000503',
  staleRevision: '018f0000-0000-7000-8000-000000000504',
  profile: '018f0000-0000-7000-8000-000000000601',
  profileVersion: '018f0000-0000-7000-8000-000000000602',
  interviewProfile: '018f0000-0000-7000-8000-000000000611',
  interviewProfileVersion: '018f0000-0000-7000-8000-000000000612',
  studioProfile: '018f0000-0000-7000-8000-000000000621',
  studioProfileVersion: '018f0000-0000-7000-8000-000000000622',
  deepSnapshot: '018f0000-0000-7000-8000-000000000901',
  deepDossier: '018f0000-0000-7000-8000-000000000902',
  deepMaterialFile: '018f0000-0000-7000-8000-000000000903',
  deepMaterialEntity: '018f0000-0000-7000-8000-000000000904',
  deepMaterialChunk: '018f0000-0000-7000-8000-000000000905',
  deepSession: '018f0000-0000-7000-8000-000000000906',
  deepTurn: '018f0000-0000-7000-8000-000000000907',
  ruleset: '018f0000-0000-7000-8000-000000000603',
  match: '018f0000-0000-7000-8000-000000000604',
  task: '018f0000-0000-7000-8000-000000000701',
  agentRun: '018f0000-0000-7000-8000-000000000801',
  toolCall: '018f0000-0000-7000-8000-000000000802',
} as const;

const campusJobs = [
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-agent-intern',
    title: '大模型应用实习生',
    department: '大模型平台',
    jobFamily: '研发',
    locations: ['深圳'],
    employmentType: '实习',
    experienceText: '在校生，有项目经验优先',
    educationText: '本科/硕士在读',
    description: '参与 Agent 应用开发、评测和工具调用链路建设。',
    detailUrl: 'https://careers.tencent.com/campus/agent-intern',
    applyUrl: 'https://careers.tencent.com/campus/agent-intern/apply',
    publishedAt: null,
  }),
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-ai-product-intern',
    title: 'AI 产品实习生',
    department: 'AI 产品部',
    jobFamily: '产品',
    locations: ['北京', '北京市海淀区中关村软件园', '远程协作'],
    employmentType: '实习',
    experienceText: '在校生',
    educationText: '本科在读',
    description: '协助 AI 产品调研、需求分析与数据评估。',
    detailUrl: 'https://careers.tencent.com/campus/ai-product-intern',
    applyUrl: 'https://careers.tencent.com/campus/ai-product-intern/apply',
    publishedAt: null,
  }),
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-legacy-intern',
    title: '历史算法实习生',
    department: '算法工程',
    jobFamily: '研发',
    locations: ['上海'],
    employmentType: '实习',
    experienceText: '在校生',
    educationText: '本科在读',
    description: '已关闭的校招实习职位。',
    detailUrl: 'https://careers.tencent.com/campus/legacy-intern',
    applyUrl: 'https://careers.tencent.com/campus/legacy-intern/apply',
    publishedAt: null,
  }),
] as const;

/** A deterministic adapter-like fixture keeps browser tests independent of public websites. */
/** 构造测试输入或执行断言的辅助逻辑。 */
class FakeAdapter {
  public readonly jobs = campusJobs;

  public normalize(job: NormalizedJob): NormalizedJob {
    return job;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function loadProfileFromFakeModel(): Promise<CandidateProfileData> {
  const model = new FakeModel<{ readonly resume: string }, CandidateProfileData>();
  const profile = makeCandidateProfile({
    targetRoles: ['研发', '大模型应用实习生', 'Agent 实习生'],
    preferences: {
      locations: ['深圳'],
      companySizes: ['large'],
      employmentTypes: ['实习'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [
      {
        institution: '某大学',
        degree: '本科在读',
        field: '计算机科学',
        startDate: null,
        endDate: null,
        evidence: [{ source: 'resume', quote: '某大学计算机科学本科在读' }],
      },
    ],
    skills: [
      {
        name: 'TypeScript',
        level: 'proficient',
        evidence: [{ source: 'resume', quote: 'TypeScript Agent 项目' }],
      },
    ],
    domains: ['大模型应用', 'Agent'],
    professionalSkills:
      '熟练使用 TypeScript 构建类型安全的前端应用。\n具备大模型应用与 Agent 工作流开发经验。',
    yearsOfExperience: null,
    managementExperience: null,
  });
  model.enqueue(profile);
  return model.invoke({ resume: '校招实习简历 fixture' });
}

function insertJob(
  database: ReturnType<typeof openSqliteDatabase>,
  job: NormalizedJob,
  input: {
    readonly id: string;
    readonly status: 'active' | 'stale' | 'closed';
    readonly revisionId: string;
    readonly updatedAt: number;
  },
): void {
  database.client
    .prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        locations_json, employment_type, recruitment_category, experience_text, education_text, description,
        detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
        last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 1, ?)`,
    )
    .run(
      input.id,
      job.companyId,
      job.sourceId,
      job.externalJobId,
      job.title,
      job.department,
      job.jobFamily,
      JSON.stringify(job.locations),
      job.employmentType,
      'internship',
      job.experienceText,
      job.educationText,
      job.description,
      job.detailUrl,
      job.applyUrl,
      input.status,
      'a'.repeat(64),
      input.updatedAt,
      input.updatedAt,
    );
  database.client
    .prepare(
      `INSERT INTO job_revisions
       (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
        source_url, snapshot_json, change_set_json, created_at)
       VALUES (?, ?, 1, ?, 'fake-campus-v1', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.revisionId,
      input.id,
      'c'.repeat(64),
      'b'.repeat(64),
      job.detailUrl,
      JSON.stringify(job),
      JSON.stringify([]),
      input.updatedAt,
    );
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function seedFixture(dataRoot: string): Promise<void> {
  const database = openSqliteDatabase({ dataRoot });
  const adapter = new FakeAdapter();
  const profile = await loadProfileFromFakeModel();
  const interviewProfile = makeCandidateProfile({
    targetRoles: [],
    projects: [
      {
        name: '校招职位 Agent',
        role: '核心开发者',
        startDate: '2026-03-01',
        endDate: null,
        highlights: ['实现可追溯的职位同步、匹配与后台任务恢复'],
        evidence: [{ source: 'resume', quote: '校招职位 Agent 项目' }],
      },
      {
        name: '文档检索网关',
        role: '后端负责人',
        startDate: '2026-05-01',
        endDate: null,
        highlights: ['通过短事务与异步 Worker 隔离外部调用'],
        evidence: [{ source: 'resume', quote: '文档检索网关项目' }],
      },
    ],
  });
  try {
    database.client
      .prepare(
        `INSERT INTO application_settings (key, value_json, schema_version, updated_at)
         VALUES ('sources.activeChannel', '{"channel":"campus"}', '1', 1)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO companies (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'browser-fixture-tencent', '腾讯校招', '[]', 1, 1, 1)`,
      )
      .run(ids.company);
    database.client
      .prepare(
        `INSERT INTO source_channels
         (id, company_id, channel, slug, enabled, created_at, updated_at)
         VALUES (?, ?, 'campus', 'browser-fixture-tencent-campus', 1, 1, 1)`,
      )
      .run(ids.channel, ids.company);
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, 'browser-fixture-tencent-campus', 'fake.campus',
          'https://careers.tencent.com/campus', '{}', 'fake-v1', '{}', 1,
          'supported', 'healthy', 0, 2, 1, 2)`,
      )
      .run(ids.source, ids.company, ids.channel);
    database.client
      .prepare(
        `INSERT INTO sync_runs
         (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
          sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
         VALUES (?, ?, 'manual', 'succeeded', 'complete', 'fake-campus-v1',
          'fake-campus-v1', 'fake-v1', 'fake-source-hash',
          '{"discovered":3,"created":3}', 1, 2)`,
      )
      .run(ids.syncRun, ids.source);

    const [activeJob, staleJob, closedJob] = adapter.jobs.map((job) => adapter.normalize(job));
    if (!activeJob || !staleJob || !closedJob)
      throw new Error('FakeAdapter fixture is incomplete.');
    insertJob(database, activeJob, {
      id: ids.activeJob,
      status: 'active',
      revisionId: ids.activeRevision,
      updatedAt: 3,
    });
    insertJob(database, staleJob, {
      id: ids.staleJob,
      status: 'stale',
      revisionId: ids.staleRevision,
      updatedAt: 2,
    });
    insertJob(database, closedJob, {
      id: ids.closedJob,
      status: 'closed',
      revisionId: '018f0000-0000-7000-8000-000000000506',
      updatedAt: 1,
    });

    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '校招实习求职画像', 1, 1)`,
      )
      .run(ids.profile);
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
      )
      .run(
        ids.profileVersion,
        ids.profile,
        JSON.stringify(profile),
        JSON.stringify(profile),
        'd'.repeat(64),
      );
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '面试准备画像', 2, 2)`,
      )
      .run(ids.interviewProfile);
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 2)`,
      )
      .run(
        ids.interviewProfileVersion,
        ids.interviewProfile,
        JSON.stringify(interviewProfile),
        JSON.stringify(interviewProfile),
        '9'.repeat(64),
      );

    // 简历制作使用独立画像；创建时间排在既有画像之后，保持默认画像不变。
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '简历制作专用画像', 3, 3)`,
      )
      .run(ids.studioProfile);
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 3)`,
      )
      .run(
        ids.studioProfileVersion,
        ids.studioProfile,
        JSON.stringify(profile),
        JSON.stringify(profile),
        createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
      );

    const deepProject = interviewProfile.projects[1];
    if (!deepProject) throw new Error('Deep drill browser fixture project is missing.');
    const materialText = [
      '# 任务与事务边界',
      '',
      '数据库事务只负责冻结任务与版本映射，外部模型调用由 Worker 在事务提交后执行。',
    ].join('\n');
    const materialBytes = Buffer.from(materialText, 'utf8');
    const materialHash = createHash('sha256').update(materialBytes).digest('hex');
    const materialChunk = {
      id: ids.deepMaterialChunk,
      heading: '任务与事务边界',
      start: 0,
      end: materialText.length,
      contentHash: contentHash(materialText),
    };
    const materialBinding = {
      fileId: ids.deepMaterialFile,
      entityId: ids.deepMaterialEntity,
      versionNo: 1,
      fileName: 'architecture.md',
      contentHash: materialHash,
    };
    database.client.transaction(() => {
      database.client
        .prepare(
          `INSERT INTO resume_project_snapshots
           (id, source_profile_id, source_profile_version_id, project_index, project_json,
            content_hash, created_at)
           VALUES (?, ?, ?, 1, ?, ?, 3)`,
        )
        .run(
          ids.deepSnapshot,
          ids.interviewProfile,
          ids.interviewProfileVersion,
          JSON.stringify(deepProject),
          contentHash(deepProject),
        );
      database.client
        .prepare(
          `INSERT INTO project_dossiers
           (id, snapshot_id, notebook_file_id, notebook_source_hash, revision, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, 0, 3, 3)`,
        )
        .run(ids.deepDossier, ids.deepSnapshot);
      database.client
        .prepare(
          `INSERT INTO files
           (id, kind, name, state, revision, properties_json, created_at, updated_at)
           VALUES (?, 'project_material', 'architecture.md', 'stored', 1, ?, 3, 3)`,
        )
        .run(
          ids.deepMaterialFile,
          JSON.stringify({ dossierId: ids.deepDossier, fileName: 'architecture.md' }),
        );
      database.client
        .prepare(
          `INSERT INTO entities
           (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
           VALUES (?, ?, 'text/markdown; charset=utf-8', ?, ?, 3, NULL)`,
        )
        .run(
          ids.deepMaterialEntity,
          `fixture/project-material/${materialHash}.md`,
          materialHash,
          materialBytes.byteLength,
        );
      database.client
        .prepare(
          `INSERT INTO file_entity_mappings
           (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
            normalized_text, error_summary, metadata_json, created_at)
           VALUES (?, ?, 1, 'project-material-markdown@v1', 'parsed', NULL, ?, NULL, ?, 3)`,
        )
        .run(
          ids.deepMaterialFile,
          ids.deepMaterialEntity,
          materialText,
          JSON.stringify({ chunks: [materialChunk] }),
        );
      database.client
        .prepare(
          `INSERT INTO drill_sessions
           (id, dossier_id, profile_key, profile_version, profile_definition_hash,
            capability_summary_json, material_bindings_json, status, context_revision,
            created_at, updated_at, completed_at)
           VALUES (?, ?, 'docs-grounded', 'v1', ?, ?, ?, 'completed', 1, 3, 4, 4)`,
        )
        .run(
          ids.deepSession,
          ids.deepDossier,
          contentHash({ profile: 'docs-grounded@v1' }),
          JSON.stringify({
            evidenceKinds: ['resume_project', 'user_answer', 'derived_claim', 'project_material'],
            tools: ['selected_markdown_heading_search', 'selected_markdown_chunk_read'],
          }),
          JSON.stringify([materialBinding]),
        );
      database.client
        .prepare(
          `INSERT INTO drill_turns
           (id, session_id, turn_no, status, context_hash, question, intent,
            primary_dimension, guidance_slots_json, evidence_refs_json, question_task_id,
            question_agent_run_id, digest_task_id, digest_agent_run_id, created_at, updated_at)
           VALUES (?, ?, 1, 'ready', ?, ?, ?, 'architecture_design', ?, ?, NULL, NULL,
                   NULL, NULL, 3, 4)`,
        )
        .run(
          ids.deepTurn,
          ids.deepSession,
          contentHash({ sessionId: ids.deepSession, turnNo: 1 }),
          '为什么把模型调用放在事务提交之后，失败时如何保持任务可重试？',
          '核实候选人是否理解外部调用与数据库短事务的边界。',
          JSON.stringify(['事务边界', '失败恢复', '幂等策略']),
          JSON.stringify([{ kind: 'project_material', id: ids.deepMaterialChunk }]),
        );
      const coverage = database.client.prepare(
        `INSERT INTO drill_coverage
         (session_id, dimension, status, evidence_item_ids_json, updated_at)
         VALUES (?, ?, ?, '[]', 4)`,
      );
      for (const dimension of drillCoverageDimensions) {
        coverage.run(
          ids.deepSession,
          dimension,
          dimension === 'architecture_design' ? 'asked' : 'unasked',
        );
      }
    })();
    database.client
      .prepare(
        `INSERT INTO match_rulesets
         (id, version, definition_json, definition_hash, active, created_at)
         VALUES (?, 'campus-v1', '{"version":"campus-v1"}', ?, 1, 1)`,
      )
      .run(ids.ruleset, 'e'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO match_results
         (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
          components_json, risks_json, input_hash, created_at)
         VALUES (?, ?, ?, ?, 'eligible', 86.5, ?, ?, ?, 3)`,
      )
      .run(
        ids.match,
        ids.profileVersion,
        ids.activeRevision,
        ids.ruleset,
        JSON.stringify([
          {
            dimension: 'skills',
            score: 31,
            maximumScore: 35,
            matchedEvidence: [
              { source: 'profile', path: '/skills/0', summary: '具备 TypeScript Agent 项目经验' },
            ],
            missingEvidence: ['生产级评测经验'],
            uncertainties: [],
          },
          {
            dimension: 'experience',
            score: 22,
            maximumScore: 25,
            matchedEvidence: [
              { source: 'job', path: '/experienceText', summary: '接受在校生申请' },
            ],
            missingEvidence: [],
            uncertainties: ['实习时长待确认'],
          },
        ]),
        JSON.stringify([
          {
            ruleId: 'campus-education',
            status: 'pass',
            evidence: [{ source: 'profile', path: '/education/0', summary: '本科在读' }],
            explanation: '学历要求与校招实习画像匹配',
          },
        ]),
        'f'.repeat(64),
      );
    database.client
      .prepare(
        `INSERT INTO tasks
         (id, task_type, payload_json, status, idempotency_key, attempt_count, max_attempts,
          available_at, created_at)
         VALUES (?, 'source.sync', '{"sourceId":"campus"}', 'pending',
          'fixture-pending-sync', 0, 3, 1, 2)`,
      )
      .run(ids.task);
    // 1、维护记录仅用于只读审计展示，不应提供普通队列的重试/取消入口。
    database.client.exec(`INSERT INTO tasks
      (id,task_type,payload_json,status,idempotency_key,attempt_count,max_attempts,available_at,created_at)
      VALUES('018f0000-0000-7000-8000-000000000709','maintenance.sqlite','{}','failed',
      'fixture-maintenance-audit',1,1,1,3)`);
    database.client
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
          cache_key, status, output_json, input_tokens, output_tokens, estimated_cost_micros,
          cost_currency, pricing_version, started_at, finished_at)
         VALUES (?, 'job-understanding', 'fake-v1', 'campus-prompt-v1', 'fake-config',
          'fake-input', 'fake-cache', 'succeeded', '{"summary":"脱敏校招实习职位理解"}',
          120, 80, 1000, 'USD', 'fake-price-v1', 2, 3)`,
      )
      .run(ids.agentRun);
    database.client
      .prepare(
        `INSERT INTO events
         (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
         VALUES (?, 'agent_run', ?, 1, 'agent.tool.finished', ?, 2)`,
      )
      .run(
        ids.toolCall,
        ids.agentRun,
        JSON.stringify({
          toolKey: 'fixture.lookup',
          inputSummary: {},
          outputSummary: { ok: true },
          status: 'succeeded',
          durationMs: 12,
          errorSummary: null,
        }),
      );
  } finally {
    database.close();
  }
}

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'jobhunter-web-browser-'));
await seedFixture(dataRoot);

// 浏览器用例使用本地 OpenAI 兼容端点，验证 Web 同步生成链路且不依赖公网模型。
const modelServer = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
  });
  request.on('end', () => {
    // 1、读取 Agent 输入中的允许证据；2、返回满足结构化契约的确定性问题。
    const payload = JSON.parse(body) as {
      readonly messages: readonly { readonly role: string; readonly content: string }[];
    };
    const userMessage = payload.messages.find((message) => message.role === 'user');
    const agentRequest = JSON.parse(userMessage?.content ?? '{}') as {
      readonly input?: {
        readonly allowedEvidenceRefs?: readonly { readonly kind: string; readonly id: string }[];
      };
    };
    const evidence = agentRequest.input?.allowedEvidenceRefs?.[0];
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  question: '这个项目最初要解决什么问题，你如何判断目标已经达成？',
                  intent: '确认项目背景和成功标准。',
                  primaryDimension: 'background_goal',
                  guidanceSlots: ['业务背景', '目标用户', '成功标准'],
                  evidenceRefs: evidence ? [evidence] : [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40 },
        }),
      );
    }, 800);
  });
});
await new Promise<void>((resolve, reject) => {
  modelServer.once('error', reject);
  modelServer.listen(0, '127.0.0.1', resolve);
});
const modelAddress = modelServer.address();
if (!modelAddress || typeof modelAddress === 'string') {
  throw new Error('Browser fixture model server did not bind a TCP port.');
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const port = process.env.PLAYWRIGHT_FIXTURE_PORT ?? '3210';
const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', port], {
  stdio: 'inherit',
  env: {
    ...process.env,
    JOBHUNTER_DATA_ROOT: dataRoot,
    JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
    JOBHUNTER_MODEL_PROVIDER: 'openai-compatible',
    JOBHUNTER_MODEL_BASE_URL: `http://127.0.0.1:${String(modelAddress.port)}/v1`,
    JOBHUNTER_MODEL_NAME: 'browser-fixture',
    JOBHUNTER_MODEL_API_KEY: 'browser-fixture-key',
    NEXT_DIST_DIR: '.next-browser-fixture',
  },
});

let cleaned = false;
const cleanup = async (): Promise<void> => {
  if (cleaned) return;
  cleaned = true;
  modelServer.close();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dataRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EBUSY')) throw error;
      await delay(250);
    }
  }
  await rm(dataRoot, { recursive: true, force: true });
};

child.once('exit', (code, signal) => {
  void cleanup().finally(() => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    child.kill(signal);
  });
}
