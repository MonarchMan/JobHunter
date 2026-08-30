import {
  CandidateProfileService,
  ProfileInspectionService,
  ProfileVersionConflictError,
} from '@jobhunter/application';
import {
  parseCandidateProfile,
  utcInstant,
  type CandidateProfileData,
  type Clock,
  type UtcInstant,
} from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class AdvancingClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    this.#value += 1;
    return utcInstant(this.#value);
  }
}

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
       (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
        cache_key, status, output_json, error_category, error_summary, input_tokens,
        output_tokens, estimated_cost_micros, cost_currency, pricing_version,
        started_at, finished_at)
       VALUES ('018f0000-0000-7000-8000-000000009003', 'resume-profile', '1', '1',
               ?, ?, 'profile-fixture', 'succeeded', '{}', NULL, NULL, 1, 1, 0, 'USD',
               'test', 1, 2)`,
    )
    .run('b'.repeat(64), 'c'.repeat(64));
  return {
    handle,
    service: new CandidateProfileService({
      repository: new SqliteCandidateProfileRepository(handle.client),
      clock: new AdvancingClock(),
      ids: new SequentialIds(),
    }),
  };
}

describe('candidate profile versioning', () => {
  it('preserves preferences and locked paths across re-extraction and exposes history', async () => {
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
      patch: { preferences: { ...first.effective.preferences, locations: ['上海'] } },
      lockedPaths: ['/preferences/locations'],
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
          ...first.extracted.skills,
          {
            name: 'Python',
            level: 'proficient',
            evidence: [{ source: 'resume', quote: 'Python 项目' }],
          },
        ],
      }),
    });

    expect(refreshed.versionNo).toBe(3);
    expect(refreshed.effective.preferences.locations).toEqual(['上海']);
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
    const inspected = new ProfileInspectionService({
      profiles: new SqliteCandidateProfileRepository(handle.client),
      agentRuns: new SqliteAgentRunStore(handle.client),
    }).current(candidate.id);
    expect(inspected).toMatchObject({
      version: {
        id: refreshed.id,
        extracted: refreshed.extracted,
        effective: refreshed.effective,
        lockedPaths: ['/preferences/locations'],
        resumeDocumentId: '018f0000-0000-7000-8000-000000009002',
      },
      extractionAgent: {
        key: 'resume-profile',
        version: '1',
        promptVersion: '1',
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
});
