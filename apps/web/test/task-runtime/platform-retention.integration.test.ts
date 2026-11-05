import { SqliteRuntimeReferenceReader } from '@jobhunter/common/persistence/runtime-reference-reader';
import { SqliteUserResourceReferenceReader } from '@jobhunter/user/persistence/resource-reference-reader';
import { SqliteMatchingResourceReferenceReader } from '@jobhunter/matching/persistence/resource-reference-reader';
import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { DeterministicMatchingService } from '@jobhunter/matching/application';
import { contentHash, parseId, SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';
import { SqlitePlatformRepository } from '@jobhunter/recruitment/persistence/platform-repository';
import { SqlitePlatformRetentionRepository } from '@jobhunter/recruitment/persistence/platform-retention-repository';

const now = 40 * 86_400_000;
const interval = 6 * 3_600_000;
const policy = { retentionDays: 30, intervalHours: 6 };

it('matches a formally saved platform job and protects its matching history from retention', async () => {
  await withDatabase((db, save) => {
    // 1、使用正式平台写入与画像仓储，验证平台来源可复用既有匹配链路。
    const jobId = save('matched');
    const ids = new SystemIdGenerator();
    const profiles = new SqliteCandidateProfileRepository(
      db.client,
      new SqliteProfileDerivedDataManager(db.client),
    );
    const profileId = parseId(ids.generate(), 'CandidateProfile');
    const profileVersionId = parseId(ids.generate(), 'ProfileVersion');
    const profile = makeCandidateProfile();
    profiles.createProfile({
      id: profileId,
      name: '测试画像',
      createdAt: utcInstant(1),
      updatedAt: utcInstant(1),
    });
    profiles.appendVersion({
      expectedCurrentVersionId: null,
      version: {
        id: profileVersionId,
        profileId,
        versionNo: 1,
        resumeDocumentId: null,
        agentRunId: null,
        extracted: profile,
        effective: profile,
        lockedPaths: [],
        contentHash: contentHash(profile),
        isCurrent: true,
        createdAt: utcInstant(1),
      },
    });
    const revisionId = db.client
      .prepare(`SELECT content_id AS id FROM jobs WHERE id=?`)
      .pluck()
      .get(jobId) as string;
    const service = new DeterministicMatchingService({
      matching: new SqliteMatchingRepository(
        db.client,
        new SqliteMatchingJobReader(db.client),
        new SqliteProfileIdentityReader(db.client),
        new SqliteAgentRunStore(db.client),
      ),
      profiles,
      ids,
      clock: { now: () => utcInstant(now) },
    });
    service.ensureRuleset();
    const input = {
      profileVersionId,
      jobRevisionId: parseId(revisionId, 'JobRevision'),
      jobEnrichmentId: null,
    };
    const first = service.compute(input);
    expect(first.created).toBe(true);
    expect(service.compute(input)).toMatchObject({ created: false, match: { id: first.match.id } });
    // 2、即使职位陈旧，匹配历史仍阻止删除；无需模型或平台网络请求。
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    const preview = repository.execute({ action: 'preview', policy }, now);
    expect(preview).toMatchObject({ eligible: 0, protected: 1 });
    if (!preview.confirmationToken) throw new Error('Missing token');
    repository.execute({ action: 'enable', confirmationToken: preview.confirmationToken }, now);
    expect(repository.execute({ action: 'run' }, now + interval).deleted).toBe(0);
    expect(
      db.client
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='match_result'`)
        .pluck()
        .get(),
    ).toBe(1);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  });
});

it('protects file and revision references, analysis results and official jobs', async () => {
  await withDatabase((db, save) => {
    const fileJob = save('file-reference');
    const revisionJob = save('revision-reference');
    const analyzedJob = save('analyzed');
    const officialJob = save('official');
    const freeJob = save('free');
    db.client
      .prepare(
        "INSERT INTO files(id,kind,name,state,properties_json,created_at,updated_at) VALUES (?,'note','保留笔记','active',?,1,1)",
      )
      .run(randomUUID(), JSON.stringify({ jobId: fileJob }));
    const revisionId = db.client
      .prepare(`SELECT content_id AS id FROM jobs WHERE id=?`)
      .pluck()
      .get(revisionJob) as string;
    db.client
      .prepare(
        "INSERT INTO events(id,stream_type,stream_id,sequence_no,event_type,payload_json,occurred_at) VALUES (?,'note',?,1,'note.created','{}',1)",
      )
      .run(randomUUID(), revisionId);
    const analyzedRevision = db.client
      .prepare(`SELECT content_id AS id FROM jobs WHERE id=?`)
      .pluck()
      .get(analyzedJob) as string;
    const agentId = randomUUID();
    db.client
      .prepare(
        "INSERT INTO agent_runs(id,agent_key,definition_hash,model_config_hash,input_hash,cache_key,status,started_at) VALUES (?,'fixture','definition',?,?,?,'succeeded',1)",
      )
      .run(agentId, 'a'.repeat(64), 'b'.repeat(64), agentId);
    db.client
      .prepare(
        `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) SELECT d.id,(SELECT id FROM jobs WHERE content_id=d.job_revision_id),'enrichment',json_object('content_id',d.job_revision_id,'agent_run_id',d.agent_run_id,'schema',d.schema_version,'content_hash',d.content_hash,'result',json(d.result_json)),d.created_at,d.created_at FROM (SELECT ? AS id,? AS job_revision_id,? AS agent_run_id,'1' AS schema_version,? AS content_hash,'{}' AS result_json,1 AS created_at) d`,
      )
      .run(randomUUID(), analyzedRevision, agentId, 'c'.repeat(64));
    const companyId = db.client
      .prepare('SELECT company_id FROM jobs WHERE id=?')
      .pluck()
      .get(officialJob) as string;
    const channelId = randomUUID();
    const sourceId = randomUUID();
    db.client
      .prepare(
        "INSERT INTO source_channels(id,company_id,channel,slug,enabled,created_at,updated_at) VALUES (?,?,'social','official-fixture',1,1,1)",
      )
      .run(channelId, companyId);
    db.client
      .prepare(
        "INSERT INTO job_sources(id,company_id,channel_id,slug,adapter_key,coverage_role,base_url,config_json,sync_policy_version,sync_policy_json,enabled,support_status,health_status,created_at,updated_at) VALUES (?,?,?,'official-fixture','official-fixture','required','https://example.com','{}','1','{}',1,'supported','unknown',1,1)",
      )
      .run(sourceId, companyId, channelId);
    db.client.prepare('UPDATE jobs SET source_id=? WHERE id=?').run(sourceId, officialJob);
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    const preview = repository.execute({ action: 'preview', policy }, now);
    expect(preview).toMatchObject({ eligible: 1, protected: 3 });
    if (!preview.confirmationToken) throw new Error('Missing token');
    repository.execute({ action: 'enable', confirmationToken: preview.confirmationToken }, now);
    expect(repository.execute({ action: 'run' }, now + interval).deleted).toBe(1);
    expect(db.client.prepare('SELECT id FROM jobs WHERE id=?').get(freeJob)).toBeUndefined();
    expect(db.client.prepare('SELECT id FROM jobs WHERE id=?').get(officialJob)).toBeDefined();
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  });
});

/** 真实保存平台职位作为清理夹具，不访问网络或用户业务库。 */
async function withDatabase(
  run: (db: ReturnType<typeof openSqliteDatabase>, save: (externalId: string) => string) => void,
): Promise<void> {
  const root = await createTemporaryDataRoot('platform-retention-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  const platform = new SqlitePlatformRepository(db.client);
  const generation = platform.reset(1);
  const ids = new SystemIdGenerator();
  const save = (externalId: string): string => {
    const taskId = ids.generate();
    db.client
      .prepare(
        "INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,max_attempts,available_at,created_at,lease_expires_at) VALUES (?,'platform.boss','{}','running',?,1,0,0,10000)",
      )
      .run(taskId, taskId);
    const id = platform.save(
      {
        externalJobId: externalId,
        externalCompanyId: 'brand',
        title: '测试职位',
        company: '测试公司',
        city: '上海',
        salary: '10K',
        experience: '不限',
        education: '本科',
        sourceUrl: `https://www.zhipin.com/job_detail/${externalId}.html`,
        description: '这是正式职位正文。',
      },
      generation,
      taskId,
      1,
    );
    db.client.prepare("UPDATE tasks SET status='succeeded' WHERE id=?").run(taskId);
    return id;
  };
  try {
    run(db, save);
  } finally {
    db.close();
    await root.cleanup();
  }
}

it('defaults to disabled, previews without deletion, consumes confirmation and waits a full interval', async () => {
  await withDatabase((db, save) => {
    save('old');
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    expect(repository.execute({ action: 'run' }, now)).toMatchObject({
      enabled: false,
      deleted: 0,
      skipped: true,
    });
    const preview = repository.execute({ action: 'preview', policy }, now);
    expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
    const token = preview.confirmationToken;
    if (!token) throw new Error('Missing token');
    expect(() =>
      repository.execute({ action: 'enable', confirmationToken: randomUUID() }, now),
    ).toThrow();
    repository.execute({ action: 'enable', confirmationToken: token }, now);
    expect(() => repository.execute({ action: 'enable', confirmationToken: token }, now)).toThrow();
    expect(repository.execute({ action: 'run' }, now + interval - 1).deleted).toBe(0);
    expect(repository.execute({ action: 'run' }, now + interval).deleted).toBe(1);
    expect(db.client.prepare('SELECT count(*) FROM job_observations').pluck().get()).toBe(0);
    expect(db.client.prepare(`SELECT count(*) FROM jobs`).pluck().get()).toBe(0);
    expect(
      db.client.prepare("SELECT count(*) FROM events WHERE stream_type='job'").pluck().get(),
    ).toBe(0);
    expect(db.client.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(1);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  });
});

it('rechecks new business references, task references and user interaction after preview', async () => {
  await withDatabase((db, save) => {
    const keep = save('referenced');
    const active = save('active-task');
    const touched = save('touched');
    const removed = save('unreferenced');
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    const preview = repository.execute({ action: 'preview', policy }, now);
    if (!preview.confirmationToken) throw new Error('Missing token');
    // 1、预览后新增业务事件和任务，执行必须保护，不信任旧候选集合。
    db.client
      .prepare(
        "INSERT INTO events(id,stream_type,stream_id,sequence_no,event_type,payload_json,occurred_at) VALUES (?,'job',?,2,'job.bookmarked','{}',?)",
      )
      .run(randomUUID(), keep, now);
    const taskId = new SystemIdGenerator().generate();
    db.client
      .prepare(
        "INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,max_attempts,available_at,created_at) VALUES (?,'fixture',?,'pending',?,1,0,0)",
      )
      .run(taskId, JSON.stringify({ nested: { jobId: active } }), taskId);
    repository.execute({ action: 'touch', jobId: touched }, now);
    repository.execute({ action: 'enable', confirmationToken: preview.confirmationToken }, now);
    expect(repository.execute({ action: 'run' }, now + interval)).toMatchObject({
      deleted: 1,
      protected: 2,
    });
    expect(db.client.prepare('SELECT id FROM jobs ORDER BY id').all()).toHaveLength(3);
    expect(db.client.prepare('SELECT id FROM jobs WHERE id=?').get(removed)).toBeUndefined();
    expect(db.client.prepare('SELECT missing_count,status FROM jobs').all()).toEqual(
      Array.from({ length: 3 }, () => ({ missing_count: 0, status: 'active' })),
    );
  });
});

it('keeps numeric external identities protected across owner reference ports', async () => {
  await withDatabase((db, save) => {
    const jobId = save('123');
    const taskId = new SystemIdGenerator().generate();
    db.client
      .prepare(
        "INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,max_attempts,available_at,created_at) VALUES (?,'fixture',?,'pending',?,1,0,0)",
      )
      .run(taskId, JSON.stringify({ nested: { externalJobId: 123 } }), taskId);
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    const preview = repository.execute({ action: 'preview', policy }, now);
    expect(preview).toMatchObject({ eligible: 0, protected: 1 });
    if (!preview.confirmationToken) throw new Error('Missing token');
    repository.execute({ action: 'enable', confirmationToken: preview.confirmationToken }, now);
    expect(repository.execute({ action: 'run' }, now + interval).deleted).toBe(0);
    expect(db.client.prepare('SELECT id FROM jobs WHERE id=?').get(jobId)).toBeDefined();
  });
});

it('expires confirmations, honors disable and bounds each transaction to 100 jobs', async () => {
  await withDatabase((db, save) => {
    for (let index = 0; index < 101; index++) save(`job-${String(index)}`);
    const repository = new SqlitePlatformRetentionRepository(db.client, [
      new SqliteRuntimeReferenceReader(db.client),
      new SqliteUserResourceReferenceReader(db.client),
      new SqliteMatchingResourceReferenceReader(db.client),
    ]);
    const first = repository.execute({ action: 'preview', policy }, now);
    if (!first.confirmationToken) throw new Error('Missing token');
    expect(() =>
      repository.execute(
        { action: 'enable', confirmationToken: first.confirmationToken ?? '' },
        now + 300_000,
      ),
    ).toThrow();
    const next = repository.execute({ action: 'preview', policy }, now);
    if (!next.confirmationToken) throw new Error('Missing token');
    repository.execute({ action: 'enable', confirmationToken: next.confirmationToken }, now);
    expect(repository.execute({ action: 'run' }, now + interval).deleted).toBe(100);
    repository.execute({ action: 'disable' }, now + interval);
    expect(repository.execute({ action: 'run' }, now + 2 * interval).deleted).toBe(0);
    expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  });
});
