import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import {
  CandidateProfileService,
  ProfileInspectionService,
  ProfileVersionConflictError,
} from '@jobhunter/user/profile';
import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/user/domain';
import { utcInstant, type Clock, type UtcInstant } from '@jobhunter/common/domain';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';

/** 构造测试输入或执行断言的辅助逻辑。 */
class AdvancingClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    this.#value += 1;
    return utcInstant(this.#value);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x8000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

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

/** 构造测试输入或执行断言的辅助逻辑。 */
function profile(overrides: Record<string, unknown> = {}): CandidateProfileData {
  return parseCandidateProfile({
    targetRoles: ['Agent 开发'],
    preferences: {
      locations: ['北京'],
      companySizes: ['large', 'medium'],
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
        evidence: [{ source: 'resume', quote: 'TypeScript 项目' }],
      },
    ],
    domains: ['大模型应用'],
    yearsOfExperience: 3,
    managementExperience: false,
    ...overrides,
  });
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly service: CandidateProfileService;
}> {
  const root = await createTemporaryDataRoot('jobhunter-profile-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  handle.client
    .prepare(
      `INSERT INTO entities
       (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
       VALUES ('018f0000-0000-7000-8000-000000009001', 'artifacts/test',
               'text/plain', ?, 100, 1, NULL)`,
    )
    .run('a'.repeat(64));
  handle.client
    .prepare(
      `INSERT INTO files
       (id, kind, name, state, revision, properties_json, created_at, updated_at)
       VALUES ('018f0000-0000-7000-8000-000000009002', 'resume', 'fixture-resume',
               'parsed', 0, '{}', 1, 1)`,
    )
    .run();
  handle.client
    .prepare(
      `INSERT INTO file_entity_mappings
       (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
        metadata_json, created_at)
       VALUES ('018f0000-0000-7000-8000-000000009002',
               '018f0000-0000-7000-8000-000000009001', 1, 'utf8@1', 'parsed',
               'TypeScript Agent RAG', '{}', 1)`,
    )
    .run();
  handle.client
    .prepare(
      `INSERT INTO agent_runs
       (id, agent_key, definition_hash, model_config_hash, input_hash,
        cache_key, status, output_json, error_category, error_summary, input_tokens,
        output_tokens, estimated_cost_micros, cost_currency, pricing_version,
        started_at, finished_at)
       VALUES ('018f0000-0000-7000-8000-000000009003', 'resume-profile', 'definition',
               ?, ?, 'profile-fixture', 'succeeded', '{}', NULL, NULL, 1, 1, 0, 'USD',
               'test', 1, 2)`,
    )
    .run('b'.repeat(64), 'c'.repeat(64));
  return {
    handle,
    service: new CandidateProfileService({
      repository: new SqliteCandidateProfileRepository(
        handle.client,
        new SqliteProfileDerivedDataManager(handle.client),
      ),
      clock: new AdvancingClock(),
      ids: new SequentialIds(),
    }),
  };
}

describe('candidate profile versioning', () => {
  it('preserves project identity through edits and ordering while ignoring model-supplied paths', async () => {
    const { service } = await setup();
    const candidate = service.createProfile('项目身份');
    const project = (name: string): CandidateProfileData['projects'][number] => ({
      name,
      role: null,
      startDate: null,
      endDate: null,
      highlights: ['开发'],
      evidence: [],
    });
    const first = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: null,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: null,
      extracted: profile({ projects: [project('A'), project('B')] }),
    });
    const [a, b] = first.effective.projects;
    if (!a || !b) throw new Error('Expected two projects');
    const edited = service.applyManualCorrection({
      profileId: candidate.id,
      expectedCurrentVersionId: first.id,
      patch: {
        projects: [
          { ...b, local_path: '/local/b' },
          { ...a, name: '改名后的 A', local_path: '/local/a' },
        ],
      },
    });
    expect(edited.effective.projects.map((item) => item.id)).toEqual([b.id, a.id]);
    const extraction = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: edited.id,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: null,
      extracted: profile({
        projects: [
          { ...project('改名后的 A'), id: 'model-id', local_path: '/model/path' },
          project('B'),
        ],
      }),
    });
    expect(extraction.effective.projects.map((item) => item.id)).toEqual([a.id, b.id]);
    expect(extraction.effective.projects.map((item) => item.local_path)).toEqual([
      '/local/a',
      '/local/b',
    ]);
    const confirmed = service.confirmExtraction({
      profileId: candidate.id,
      candidateVersionId: extraction.id,
      expectedCurrentVersionId: edited.id,
      fields: ['projects'],
    });
    const cleared = service.applyManualCorrection({
      profileId: candidate.id,
      expectedCurrentVersionId: confirmed.id,
      patch: {
        projects: confirmed.effective.projects.map((item) => ({ ...item, local_path: null })),
      },
    });
    expect(cleared.effective.projects.every((item) => item.local_path === null)).toBe(true);
  });

  it('requires explicit field selection for re-extraction and rejects stale candidates', async () => {
    const { handle, service } = await setup();
    const candidate = service.createProfile('脱敏候选人');
    const first = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: null,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: '018f0000-0000-7000-8000-000000009003',
      extracted: profile(),
    });
    const corrected = service.applyManualCorrection({
      profileId: candidate.id,
      expectedCurrentVersionId: first.id,
      patch: {
        targetRoles: ['研发'],
        intendedRoles: ['算法工程师', 'Agent 开发工程师'],
        preferences: { ...first.effective.preferences, locations: ['上海'] },
      },
    });
    // 两字段独立往返 SQLite；人工意向不需要额外锁定即可跨重新提取保留。
    expect(
      new SqliteCandidateProfileRepository(
        handle.client,
        new SqliteProfileDerivedDataManager(handle.client),
      ).getCurrentVersion(candidate.id),
    ).toMatchObject({
      effective: { targetRoles: ['研发'], intendedRoles: ['算法工程师', 'Agent 开发工程师'] },
    });
    const refreshed = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: corrected.id,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: '018f0000-0000-7000-8000-000000009003',
      extracted: profile({
        targetRoles: ['大模型算法'],
        preferences: { ...first.effective.preferences, locations: ['深圳'] },
        skills: [
          ...first.effective.skills,
          {
            name: 'Python',
            level: 'proficient',
            evidence: [{ source: 'resume', quote: 'Python 项目' }],
          },
        ],
      }),
    });

    expect(refreshed.versionNo).toBe(3);
    expect(refreshed.effective.preferences.locations).toEqual(['深圳']);
    expect(service.getCurrent(candidate.id)?.id).toBe(corrected.id);
    expect(refreshed.isCandidate).toBe(true);
    expect(refreshed.effective.targetRoles).toEqual(['大模型算法']);
    expect(refreshed.effective.skills.map((skill) => skill.name)).toEqual(['TypeScript', 'Python']);
    expect(service.history(candidate.id).map((version) => version.versionNo)).toEqual([3, 2, 1]);
    expect(handle.client.prepare('SELECT count(*) FROM profile_versions').pluck().get()).toBe(3);
    expect(
      handle.client
        .prepare('SELECT count(*) FROM profile_versions WHERE is_current = 1')
        .pluck()
        .get(),
    ).toBe(1);
    const confirmed = service.confirmExtraction({
      profileId: candidate.id,
      candidateVersionId: refreshed.id,
      expectedCurrentVersionId: corrected.id,
      fields: ['skills'],
    });
    expect(confirmed.effective.preferences.locations).toEqual(['上海']);
    expect(confirmed.effective.targetRoles).toEqual(['研发']);
    expect(confirmed.effective.intendedRoles).toEqual(['算法工程师', 'Agent 开发工程师']);
    expect(confirmed.effective.skills).toHaveLength(2);
    expect(() =>
      service.confirmExtraction({
        profileId: candidate.id,
        candidateVersionId: refreshed.id,
        expectedCurrentVersionId: confirmed.id,
        fields: ['skills'],
      }),
    ).toThrow(ProfileVersionConflictError);
    const inspected = new ProfileInspectionService({
      profiles: new SqliteCandidateProfileRepository(
        handle.client,
        new SqliteProfileDerivedDataManager(handle.client),
      ),
      agentRuns: new SqliteAgentRunStore(handle.client),
    }).current(candidate.id);
    expect(inspected).toMatchObject({
      version: {
        id: confirmed.id,
        effective: confirmed.effective,
        resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      },
      extractionAgent: {
        key: 'resume-profile',
        definitionHash: 'definition',
      },
    });
  });

  it('rejects stale expected-current writes without changing the active version', async () => {
    const { service } = await setup();
    const candidate = service.createProfile('候选人');
    const first = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: null,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: '018f0000-0000-7000-8000-000000009003',
      extracted: profile(),
    });
    const second = service.updatePreferences({
      profileId: candidate.id,
      expectedCurrentVersionId: first.id,
      preferences: { ...first.effective.preferences, locations: ['杭州'] },
    });
    expect(() =>
      service.updatePreferences({
        profileId: candidate.id,
        expectedCurrentVersionId: first.id,
        preferences: { ...first.effective.preferences, locations: ['深圳'] },
      }),
    ).toThrow(ProfileVersionConflictError);
    expect(service.getCurrent(candidate.id)?.id).toBe(second.id);
  });

  it('retains only the latest five profile versions without reusing version numbers', async () => {
    const { handle, service } = await setup();
    const candidate = service.createProfile('候选人');
    let current = service.applyExtraction({
      profileId: candidate.id,
      expectedCurrentVersionId: null,
      resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      agentRunId: '018f0000-0000-7000-8000-000000009003',
      extracted: profile(),
    });
    for (const location of ['上海', '杭州', '深圳', '广州', '成都', '南京']) {
      current = service.updatePreferences({
        profileId: candidate.id,
        expectedCurrentVersionId: current.id,
        preferences: { ...current.effective.preferences, locations: [location] },
      });
    }

    expect(current.versionNo).toBe(7);
    expect(service.history(candidate.id).map((version) => version.versionNo)).toEqual([
      7, 6, 5, 4, 3,
    ]);
    expect(handle.client.prepare('SELECT count(*) FROM profile_versions').pluck().get()).toBe(5);
  });
});
