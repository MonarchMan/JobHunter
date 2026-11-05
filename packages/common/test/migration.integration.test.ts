import { periodicConfigProjection } from '../src/persistence/periodic-config.js';
import { SqliteBackupOperations } from '../src/persistence/backup-operations.js';
import {
  acquireTaskServiceLock,
  withTaskServiceOwnership,
} from '../src/persistence/task-service-lock.js';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as health from '@jobhunter/common/persistence/health';
import { SqliteModelRequestRepository } from '../src/persistence/model-request-repository.js';
import { modelBillingSchema } from '../src/contracts/model-usage.js';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';

const dataRoots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

it('expands profile fields and migrates only the latest answer into durable AI messages', async () => {
  const root = await createTemporaryDataRoot('jobhunter-ai-upgrade-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-ai-profile', 57);
  const old = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(old);
  old.client.exec(`
    INSERT INTO candidate_profiles VALUES('profile','候选人',1,1);
    INSERT INTO profile_versions(id,profile_id,version_no,extracted_json,effective_json,locked_paths_json,content_hash,is_current,created_at)
    VALUES('version','profile',1,'{}','{"basicInfo":{"name":"测试"},"projects":[{"name":"项目"}],"professionalSkills":"TypeScript","yearsOfExperience":2,"managementExperience":false}','["/projects"]','${'a'.repeat(64)}',1,1);
    INSERT INTO project_dossiers(id,snapshot_id,source_profile_id,source_profile_version_id,project_index,project_json,content_hash,snapshot_created_at,revision,created_at,updated_at)
    VALUES('dossier','snapshot','profile','version',0,'{"name":"项目"}','${'b'.repeat(64)}',1,0,1,1);
    INSERT INTO drill_sessions(id,dossier_id,profile_key,profile_version,profile_definition_hash,capability_summary_json,status,context_revision,created_at,updated_at)
    VALUES('session','dossier','resume-only','v1','${'c'.repeat(64)}','{}','completed',2,1,5);
    INSERT INTO drill_turns(id,session_id,turn_no,status,context_hash,question,created_at,updated_at)
    VALUES('question','session',1,'ready','${'d'.repeat(64)}','介绍项目',1,4);
    INSERT INTO drill_answer_revisions VALUES('answer-old','question',1,'旧回答','${'e'.repeat(64)}','first',2);
    INSERT INTO drill_answer_revisions VALUES('answer-latest','question',2,'最新回答','${'f'.repeat(64)}','second',3);
  `);
  old.close();
  const db = openSqliteDatabase({ dataRoot: root.path });
  handles.push(db);
  expect(
    db.client.prepare('SELECT role,content,sequence FROM ai_messages ORDER BY sequence').all(),
  ).toEqual([
    { role: 'assistant', content: '介绍项目', sequence: 1 },
    { role: 'user', content: '最新回答', sequence: 2 },
  ]);
  expect(db.client.prepare('SELECT type,title FROM ai_sessions').get()).toEqual({
    type: 'interview',
    title: '项目',
  });
  expect(
    db.client
      .prepare("SELECT value FROM ai_session_metadata WHERE name='project_id'")
      .pluck()
      .get(),
  ).toBe('profile:project:0');
  expect(
    db.client
      .prepare(
        'SELECT professional_skills,years_of_experience,management_experience FROM profile_versions',
      )
      .get(),
  ).toEqual({
    professional_skills: 'TypeScript',
    years_of_experience: 2,
    management_experience: 0,
  });
  const columns = (db.client.pragma('table_info(profile_versions)') as { name: string }[]).map(
    (row) => row.name,
  );
  for (const name of ['effective_json', 'extracted_json', 'locked_paths_json'])
    expect(columns).not.toContain(name);
  for (const name of [
    'drill_sessions',
    'drill_turns',
    'drill_answer_revisions',
    'project_knowledge_items',
  ])
    expect(
      db.client.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name),
    ).toBeUndefined();
  expect(
    db.client.prepare("SELECT name FROM sqlite_master WHERE name='project_dossiers'").get(),
  ).toBeUndefined();
  expect(db.client.prepare('SELECT count(*) FROM ai_messages').pluck().get()).toBe(2);
  expect(db.client.pragma('foreign_key_check')).toEqual([]);
  expect(db.client.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
});

it('migrates research checkpoints into tasks without coupling accepted experiences to task retention', async () => {
  const root = await createTemporaryDataRoot('jobhunter-research-upgrade-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-research-tasks', 60);
  const old = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(old);
  old.client.exec(`
    INSERT INTO files(id,kind,name,state,revision,properties_json,created_at,updated_at)
    VALUES('asset','interview_research','bundle.json','accepted',0,'{}',1,1);
    INSERT INTO experience_research_requests(id,brief_json,request_fingerprint,prompt_hash,schema_version,
      prompt_file_id,prompt_file_version_no,schema_file_id,schema_file_version_no,bundle_file_id,bundle_file_version_no,state,revision,created_at,updated_at)
    VALUES('research','{}','${'a'.repeat(64)}','hash','v2','asset',1,'asset',1,'asset',1,'completed',2,1,3);
    INSERT INTO interview_experiences(id,file_id,sequence_no,source_type,review_status,research_request_id,source_url,source_title,source_retrieved_at,verification_status)
    VALUES('experience','asset',1,'community','accepted','research','https://example.com/interview','来源','2026-11-06T00:00:00Z','unverified');
    INSERT INTO interview_question_entries(id,experience_id,sequence_no,question) VALUES('question','experience',1,'如何设计事务？');
  `);
  old.close();
  const upgraded = openSqliteDatabase({ dataRoot: root.path });
  handles.push(upgraded);
  expect(
    upgraded.client
      .prepare(
        "SELECT status,json_extract(private_state,'$.research.revision') AS revision FROM tasks WHERE id='research'",
      )
      .get(),
  ).toEqual({ status: 'succeeded', revision: 2 });
  expect(
    upgraded.client
      .prepare("SELECT name FROM sqlite_master WHERE name='experience_research_requests'")
      .get(),
  ).toBeUndefined();
  upgraded.client.prepare("DELETE FROM tasks WHERE id='research'").run();
  expect(
    upgraded.client
      .prepare(
        "SELECT research_task_id,review_status FROM interview_experiences WHERE id='experience'",
      )
      .get(),
  ).toEqual({ research_task_id: null, review_status: 'accepted' });
  expect(
    upgraded.client.prepare('SELECT count(*) FROM interview_question_entries').pluck().get(),
  ).toBe(1);
  expect(upgraded.client.pragma('foreign_key_check')).toEqual([]);
});

it('backs up a legacy database without applying pending migrations to the source or snapshot', async () => {
  const root = await createTemporaryDataRoot('jobhunter-before-upgrade-backup-');
  dataRoots.push(root);
  const dataRoot = path.join(root.path, 'data');
  const folder = await migrationsBefore(root.path, 'legacy', 56);
  openSqliteDatabase({ dataRoot, migrationsFolder: folder }).close();
  const destination = path.join(root.path, 'backup');
  await new SqliteBackupOperations(dataRoot).create(destination);
  // 备份是升级前的回退依据，源库和快照都应保留旧表与旧迁移位置。
  for (const directory of [dataRoot, destination]) {
    const database = new Database(path.join(directory, 'jobhunter.sqlite'), { readonly: true });
    try {
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name='sync_runs'").pluck().get(),
      ).toBe('sync_runs');
      expect(database.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(56);
      expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      database.close();
    }
  }
});

it('merges scans into task stages and preserves observation identity and parent cancellation', async () => {
  const root = await createTemporaryDataRoot('jobhunter-scan-task-upgrade-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-scans', 56);
  const old = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(old);
  old.client.exec(`
    INSERT INTO companies(id,slug,name,aliases_json,enabled,created_at,updated_at) VALUES('company','company','Fixture','[]',1,1,1);
    INSERT INTO source_channels(id,company_id,channel,slug,enabled,created_at,updated_at) VALUES('channel','company','social','fixture-social',1,1,1);
    INSERT INTO job_sources(id,company_id,channel_id,slug,adapter_key,base_url,config_json,sync_policy_version,sync_policy_json,enabled,support_status,health_status,consecutive_failures,created_at,updated_at)
      VALUES('source','company','channel','fixture','fixture','https://example.com','{}','v1','{}',1,'supported','healthy',0,1,1);
    INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at)
      VALUES('parent','source.sync','{"sourceId":"source","trigger":"manual"}','{"runId":"scan"}','succeeded','parent',3,5,1,1);
    INSERT INTO sync_runs(id,source_id,trigger,status,coverage,adapter_version,normalizer_version,sync_policy_version,source_config_hash,stats_json,started_at,finished_at)
      VALUES('scan','source','manual','partial','partial','v1','v1','v1','hash','{"discovered":2}',1,2);
    INSERT INTO jobs(id,company_id,source_id,external_job_id,title,locations_json,description,detail_url,apply_url,status,missing_count,content_hash,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES('job','company','source','job','Fixture','[]','Fixture','https://example.com','https://example.com','active',0,'${'a'.repeat(64)}',1,1,1,1);
    INSERT INTO job_observations(job_id,sync_run_id,observed_at) VALUES('job','scan',2);
    INSERT INTO sync_seen_jobs(sync_run_id,job_id) VALUES('scan','job');
  `);
  old.close();
  const db = openSqliteDatabase({ dataRoot: root.path });
  handles.push(db);
  expect(
    db.client.prepare("SELECT name FROM sqlite_master WHERE name='sync_runs'").get(),
  ).toBeUndefined();
  expect(
    db.client
      .prepare(
        "SELECT parent_task_id,status,json_extract(public_state,'$.status') AS scan_status,json_extract(public_state,'$.stats.discovered') AS discovered FROM tasks WHERE id='scan'",
      )
      .get(),
  ).toEqual({
    parent_task_id: 'parent',
    status: 'succeeded',
    scan_status: 'partial',
    discovered: 2,
  });
  expect(db.client.prepare("SELECT attempt_count FROM tasks WHERE id='parent'").pluck().get()).toBe(
    3,
  );
  expect(db.client.prepare('SELECT sync_run_id FROM job_observations').pluck().get()).toBe('scan');
  expect(db.client.pragma('foreign_key_check')).toEqual([]);
  db.client
    .exec(`UPDATE tasks SET status='running',lease_owner='attempt-4',lease_expires_at=100 WHERE id='parent';
    INSERT INTO tasks(id,task_type,parent_task_id,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at)
      VALUES('next-scan','source.scan','parent','{"sourceId":"source","trigger":"retry"}','{}','running','next-scan',1,1,3,3);
    UPDATE tasks SET status='pending',lease_owner=NULL,available_at=4 WHERE id='parent';`);
  expect(
    db.client.prepare("SELECT status,finished_at FROM tasks WHERE id='next-scan'").get(),
  ).toEqual({ status: 'cancelled', finished_at: 4 });
  expect(db.client.prepare("SELECT status FROM tasks WHERE id='scan'").pluck().get()).toBe(
    'succeeded',
  );
  expect(db.client.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(dataRoots.splice(0).map((root) => root.cleanup()));
});

it('moves periodic configuration into settings without losing due progress or queued tasks', async () => {
  const root = await createTemporaryDataRoot('jobhunter-periodic-settings-upgrade-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-periodic', 54);
  const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(legacy);
  legacy.client.exec(`
    INSERT INTO schedules(id,schedule_key,task_type,payload_json,cron_expression,timezone,
      enabled,next_run_at,last_enqueued_at,created_at,updated_at)
    VALUES ('periodic-id','fixture.daily','fixture.task','{"sourceId":"fixture"}',
      '0 9 * * *','Asia/Shanghai',1,2000,1000,10,20);
    INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,schedule_id,
      attempt_count,max_attempts,available_at,created_at)
    VALUES('queued-task','fixture.task','{}','pending','schedule:fixture.daily:1000',
      'periodic-id',2,5,1000,10);
  `);
  legacy.close();
  const current = openSqliteDatabase({ dataRoot: root.path });
  handles.push(current);
  expect(
    current.client.prepare("SELECT name FROM sqlite_master WHERE name = 'schedules'").get(),
  ).toBeUndefined();
  expect(
    current.client
      .prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'schedule_id'")
      .get(),
  ).toBeUndefined();
  expect(
    current.client
      .prepare(
        `SELECT id, next_run_at, last_enqueued_at, timezone, payload_json FROM ${periodicConfigProjection}`,
      )
      .get(),
  ).toEqual({
    id: 'periodic-id',
    next_run_at: 2000,
    last_enqueued_at: 1000,
    timezone: 'Asia/Shanghai',
    payload_json: '{"sourceId":"fixture"}',
  });
  expect(
    current.client
      .prepare('SELECT id, status, attempt_count, max_attempts, idempotency_key FROM tasks')
      .get(),
  ).toEqual({
    id: 'queued-task',
    status: 'pending',
    attempt_count: 2,
    max_attempts: 5,
    idempotency_key: 'schedule:fixture.daily:1000',
  });
  expect(current.client.pragma('foreign_key_check')).toEqual([]);
  expect(current.client.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
});

it('checks new databases and explicit verification but avoids full scans on ordinary reopen', async () => {
  const integrity = vi.spyOn(health, 'assertDatabaseIntegrity');
  const first = await openTestDatabase();
  expect(integrity).toHaveBeenCalledTimes(1);
  first.close();
  const reopened = openSqliteDatabase({ dataRoot: first.dataRoot });
  handles.push(reopened);
  expect(integrity).toHaveBeenCalledTimes(1);
  reopened.close();
  const checked = openSqliteDatabase({ dataRoot: first.dataRoot, checkIntegrity: true });
  handles.push(checked);
  expect(integrity).toHaveBeenCalledTimes(2);
});

it('blocks schema upgrades while a service owns the data root and permits its startup migration', async () => {
  const root = await createTemporaryDataRoot('jobhunter-migration-service-gate-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-task-states', 55);
  const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(legacy);
  legacy.close();
  const release = acquireTaskServiceLock(root.path);
  if (!release) throw new Error('Expected service ownership');
  try {
    expect(() => openSqliteDatabase({ dataRoot: root.path })).toThrow(
      'Database upgrade requires stopping the central task service',
    );
    const unchanged = openSqliteDatabase({ dataRoot: root.path, runMigrations: false });
    handles.push(unchanged);
    expect(
      unchanged.client
        .prepare("SELECT name FROM pragma_table_info('tasks') WHERE name='payload_json'")
        .get(),
    ).toBeDefined();
    unchanged.close();
    const owned = withTaskServiceOwnership(root.path, () =>
      openSqliteDatabase({ dataRoot: root.path }),
    );
    handles.push(owned);
    expect(
      owned.client
        .prepare("SELECT name FROM pragma_table_info('tasks') WHERE name='private_state'")
        .get(),
    ).toBeDefined();
    owned.close();
    // 同版本普通客户端仍允许连接，不把日常查询误判为迁移。
    const query = openSqliteDatabase({ dataRoot: root.path });
    handles.push(query);
    query.close();
  } finally {
    release();
  }
});

it('preserves task input, checkpoints and indexed relations when renaming task states', async () => {
  const root = await createTemporaryDataRoot('jobhunter-task-states-upgrade-');
  dataRoots.push(root);
  const folder = await migrationsBefore(root.path, 'before-task-states', 55);
  const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
  handles.push(legacy);
  const payload = JSON.stringify({ sourceId: 'source', runId: 'scan', externalJobId: 'job' });
  const checkpoint = JSON.stringify({ stage: 'scoring', saved: 4 });
  legacy.client
    .prepare(
      `INSERT INTO tasks
    (id,task_type,payload_json,result_json,status,idempotency_key,attempt_count,max_attempts,available_at,created_at)
    VALUES('task','source.job-detail',?,?,'pending','task',2,5,1,1)`,
    )
    .run(payload, checkpoint);
  legacy.close();
  const current = openSqliteDatabase({ dataRoot: root.path });
  handles.push(current);
  expect(
    current.client
      .prepare('SELECT private_state,public_state,source_id,source_run_id,attempt_count FROM tasks')
      .get(),
  ).toEqual({
    private_state: payload,
    public_state: checkpoint,
    source_id: 'source',
    source_run_id: 'scan',
    attempt_count: 2,
  });
  expect(
    current.client
      .prepare(
        "SELECT name FROM pragma_table_info('tasks') WHERE name IN ('payload_json','result_json')",
      )
      .all(),
  ).toEqual([]);
  // 列重命名还必须更新既有 JSON 关系投影触发器，不能只迁移旧行。
  current.client
    .prepare('UPDATE tasks SET private_state = ? WHERE id = ?')
    .run(JSON.stringify({ sourceId: 'next-source', runId: 'next-scan' }), 'task');
  expect(current.client.prepare('SELECT source_id,source_run_id FROM tasks').get()).toEqual({
    source_id: 'next-source',
    source_run_id: 'next-scan',
  });
  expect(current.client.pragma('foreign_key_check')).toEqual([]);
  expect(current.client.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function openTestDatabase(): Promise<SqliteDatabaseHandle> {
  const dataRoot = await createTemporaryDataRoot('jobhunter-db-');
  dataRoots.push(dataRoot);
  const handle = openSqliteDatabase({ dataRoot: dataRoot.path, busyTimeoutMs: 2_500 });
  handles.push(handle);
  return handle;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function migrationsBefore(
  root: string,
  directoryName: string,
  firstExcludedIndex: number,
): Promise<string> {
  const folder = path.join(root, directoryName);
  const metadataFolder = path.join(folder, 'meta');
  await mkdir(metadataFolder, { recursive: true });
  const journal = JSON.parse(
    await readFile(new URL('../migrations/legacy/meta/_journal.json', import.meta.url), 'utf8'),
  ) as {
    readonly version: string;
    readonly dialect: string;
    readonly entries: readonly { readonly idx: number; readonly tag: string }[];
  };
  const entries = journal.entries.filter((entry) => entry.idx < firstExcludedIndex);
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        new URL(`../migrations/legacy/${entry.tag}.sql`, import.meta.url),
        path.join(folder, `${entry.tag}.sql`),
      ),
    ),
  );
  await writeFile(
    path.join(metadataFolder, '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return folder;
}

describe('SQLite migrations and capabilities', () => {
  it('migrates populated current job metadata and preserves independent IDs and model reasons', async () => {
    const root = await createTemporaryDataRoot('job-metadata-migration-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-metadata', 53);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO candidate_profiles(id,name,created_at,updated_at) VALUES('p','Fixture',1,1);
      INSERT INTO profile_versions(id,profile_id,version_no,extracted_json,effective_json,content_hash,is_current,created_at) VALUES('pv','p',1,'{}','{}','hash',1,1);
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('retention-company', 'retention-company', 'Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('retention-channel', 'retention-company', 'social', 'retention-channel', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, coverage_role, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('retention-source', 'retention-company', 'retention-channel', 'retention-source',
              'retention.source', 'required', 'https://example.com', '{}', 'v1', '{}', 1,
              'supported', 'healthy', 0, 1, 1);
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, locations_json, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at, last_seen_at,
         created_at, updated_at)
      VALUES ('retention-job', 'retention-company', 'retention-source', 'job', 'Engineer', '[]',
              'Build systems', 'https://example.com/job', 'https://example.com/job', 'active', 0,
              'job-hash', 1, 1, 1, 1);
      INSERT INTO job_revisions
        (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
         source_url, snapshot_json, change_set_json, created_at)
      VALUES ('retention-revision', 'retention-job', 1, 'revision-hash', 'v1',
              '${'a'.repeat(64)}', 'https://example.com/job', '{}', '[]', 1);
      INSERT INTO match_rulesets
        (id, definition_json, definition_hash, active, created_at)
      VALUES ('retention-ruleset', '{}', 'retention-rules-hash', 1, 1);

      INSERT INTO agent_runs(id,agent_key,definition_hash,model_config_hash,input_hash,cache_key,status,output_json,started_at) VALUES('agent','test','definition','model','input','cache','succeeded','{}',1);
      INSERT INTO job_enrichments(id,job_revision_id,agent_run_id,schema_version,content_hash,result_json,created_at) VALUES('enrich','retention-revision','agent','schema','hash','{}',2);
      INSERT INTO match_results(id,profile_version_id,job_revision_id,job_enrichment_id,ruleset_id,filter_status,total_score,model_score,components_json,risks_json,input_hash,created_at)
      VALUES('score','pv','retention-revision','enrich','retention-ruleset','uncertain',74,80,
      '[{"dimension":"role","score":60,"maximumScore":100,"matchedEvidence":[],"missingEvidence":["未命中"],"uncertainties":[]},{"dimension":"model","score":56,"maximumScore":70,"modelScore":80,"matchedEvidence":[{"source":"enrichment","path":"/fitScore","summary":"项目经历匹配"}],"missingEvidence":[],"uncertainties":[]}]',
      '[{"ruleId":"preference.role","status":"fail","evidence":[],"explanation":"未命中"},{"ruleId":"qualification.condition","status":"unknown","evidence":[],"explanation":"未设置"},{"ruleId":"preference.location","status":"pass","evidence":[],"explanation":"通过"}]','input',3);
      INSERT INTO match_advices(id,match_result_id,agent_run_id,schema_version,content_hash,result_json,created_at) VALUES('advice','score','agent','schema','hash','{}',4);
    `);
    legacy.close();
    const db = openSqliteDatabase({ dataRoot: root.path });
    handles.push(db);
    const rows = db.client
      .prepare('SELECT id,name,value,created_at FROM job_metadata ORDER BY created_at')
      .all() as { id: string; name: string; value: string; created_at: number }[];
    expect(rows.map((r) => r.id)).toEqual(['enrich', 'score', 'advice']);
    expect(JSON.parse(rows[1]?.value ?? '{}')).toMatchObject({
      components: [{ dimension: 'role', score: 60, max_score: 100 }],
      risk_results: ['preference.role'],
      unknown_rules: ['qualification.condition'],
      model: { score: 80, reasons: ['项目经历匹配'] },
    });
    expect(rows[1]?.value).not.toMatch(/未命中|未设置|matchedEvidence|explanation/);
    expect(
      db.client.prepare("SELECT content_id FROM jobs WHERE id='retention-job'").pluck().get(),
    ).toBe('retention-revision');
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
    db.client.prepare("DELETE FROM jobs WHERE id='retention-job'").run();
    expect(db.client.prepare('SELECT count(*) FROM job_metadata').pluck().get()).toBe(0);
  });

  it('merges populated interview storage without losing identities, evidence, children or cascade behavior', async () => {
    const root = await createTemporaryDataRoot('interview-storage-upgrade-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-compact', 49);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    // 1、在旧 Schema 建立完整引用链，快照和档案使用不同时间，避免迁移误覆盖。
    legacy.client.exec(`
      INSERT INTO resume_project_snapshots VALUES ('snapshot','profile','version',2,'{"name":"合成项目"}','${'a'.repeat(64)}',10);
      INSERT INTO project_dossiers VALUES ('dossier','snapshot',NULL,NULL,3,20,30);
      INSERT INTO drill_sessions(id,dossier_id,profile_key,profile_version,profile_definition_hash,capability_summary_json,material_bindings_json,status,context_revision,created_at,updated_at)
        VALUES ('session','dossier','docs-grounded','v1','${'b'.repeat(64)}','{}','[{"fileId":"018f0000-0000-7000-8000-000000000201","entityId":"018f0000-0000-7000-8000-000000000202","versionNo":1,"fileName":"architecture.md","contentHash":"${'e'.repeat(64)}"}]','active',4,40,50);
      INSERT INTO drill_turns(id,session_id,turn_no,status,context_hash,evidence_refs_json,created_at,updated_at)
        VALUES ('turn','session',1,'ready','${'c'.repeat(64)}','[{"kind":"resume_project","id":"snapshot"}]',60,70);
      INSERT INTO drill_answer_revisions VALUES ('answer','turn',1,'合成回答','${'d'.repeat(64)}','token',80);
      INSERT INTO project_knowledge_items VALUES ('knowledge','dossier','answer','fact','合成事实','合成',0,2,'active',90);
      INSERT INTO drill_coverage VALUES ('session','architecture_design','evidence_sufficient','["knowledge"]',100);
      INSERT INTO drill_coverage VALUES ('session','data_metrics','unasked','[]',101);
    `);
    const preservedTables = [
      'drill_sessions',
      'drill_turns',
      'drill_answer_revisions',
      'project_knowledge_items',
    ];
    const before = preservedTables.map((table) =>
      legacy.client.prepare(`SELECT * FROM ${table}`).all(),
    );
    legacy.close();
    // 2、升级只移动存储位置，快照证据 ID、修订号、材料绑定及子表内容均不变。
    const upgraded = openSqliteDatabase({
      dataRoot: root.path,
      migrationsFolder: await migrationsBefore(root.path, 'through-compact', 50),
    });
    handles.push(upgraded);
    expect(
      upgraded.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('resume_project_snapshots','drill_coverage')",
        )
        .all(),
    ).toEqual([]);
    expect(upgraded.client.prepare('SELECT * FROM project_dossiers').get()).toMatchObject({
      id: 'dossier',
      snapshot_id: 'snapshot',
      project_index: 2,
      project_json: '{"name":"合成项目"}',
      snapshot_created_at: 10,
      created_at: 20,
      updated_at: 30,
      revision: 3,
    });
    const coverage = JSON.parse(
      upgraded.client.prepare('SELECT coverage_json FROM drill_sessions').pluck().get() as string,
    ) as unknown;
    expect(coverage).toEqual({
      architecture_design: {
        status: 'evidence_sufficient',
        evidenceItemIds: ['knowledge'],
        updatedAt: 100,
      },
      data_metrics: { status: 'unasked', evidenceItemIds: [], updatedAt: 101 },
    });
    for (const [index, table] of preservedTables.entries()) {
      const after = upgraded.client.prepare(`SELECT * FROM ${table}`).all() as Record<
        string,
        unknown
      >[];
      if (table === 'drill_sessions') for (const row of after) delete row.coverage_json;
      expect(after).toEqual(before[index]);
    }
    expect(upgraded.client.pragma('foreign_key_check')).toEqual([]);
    // 3、再次打开不重复搬运；删除档案仍级联清理全部问答状态。
    const reopened = openSqliteDatabase({
      dataRoot: root.path,
      migrationsFolder: await migrationsBefore(root.path, 'through-compact-reopen', 50),
    });
    handles.push(reopened);
    expect(reopened.client.prepare('SELECT coverage_json FROM drill_sessions').pluck().get()).toBe(
      JSON.stringify(coverage),
    );
    reopened.client.prepare("DELETE FROM project_dossiers WHERE id='dossier'").run();
    for (const table of preservedTables)
      expect(reopened.client.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
  });

  it('rolls back interview storage migration instead of discarding an orphan snapshot', async () => {
    const root = await createTemporaryDataRoot('interview-storage-orphan-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-compact', 49);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    legacy.client
      .prepare('INSERT INTO resume_project_snapshots VALUES (?,?,?,?,?,?,?)')
      .run('orphan', 'profile', 'version', 0, '{}', 'a'.repeat(64), 1);
    legacy.close();
    expect(() => openSqliteDatabase({ dataRoot: root.path })).toThrow();
    const unchanged = openSqliteDatabase({ dataRoot: root.path, runMigrations: false });
    handles.push(unchanged);
    expect(
      unchanged.client.prepare('SELECT count(*) FROM resume_project_snapshots').pluck().get(),
    ).toBe(1);
  });

  it('moves request snapshots without repricing and removes the duplicate array (USG-011)', async () => {
    const root = await createTemporaryDataRoot('ledger-upgrade-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-ledger', 48);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    const billing = modelBillingSchema.parse({
      model: 'synthetic',
      requestedAt: 10,
      inputTokens: 100,
      outputTokens: 20,
      uncachedInputTokens: 10,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      inputCostMicros: 1,
      outputCostMicros: 2,
      cacheReadCostMicros: 3,
      cacheWriteCostMicros: 4,
      totalCostMicros: 10,
      currency: 'CNY',
      pricingVersion: 'historic',
      period: 'off-peak',
      precision: 'reported',
      rates: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      outputTokensPerSecond: 12.5,
      durationMs: 1700,
      firstTokenMs: 100,
    });
    legacy.client
      .prepare(
        `INSERT INTO agent_runs (id,agent_key,agent_version,prompt_version,model_config_hash,input_hash,cache_key,status,started_at,model_usage_json,input_tokens,estimated_cost_micros) VALUES ('old','test','1','1','m','i','c','failed',1,?,100,10)`,
      )
      .run(JSON.stringify([billing, { ...billing, totalCostMicros: null, rates: null }]));
    const before = legacy.client
      .prepare('SELECT input_tokens, estimated_cost_micros FROM agent_runs')
      .get();
    legacy.close();
    const upgraded = openSqliteDatabase({ dataRoot: root.path });
    expect(
      upgraded.client.prepare('SELECT input_tokens, estimated_cost_micros FROM agent_runs').get(),
    ).toEqual(before);
    expect(
      upgraded.client
        .prepare("SELECT name FROM pragma_table_info('agent_runs') WHERE name = 'model_usage_json'")
        .get(),
    ).toBeUndefined();
    const calls = new SqliteModelRequestRepository(upgraded.client).listForRun('old');
    expect(calls).toMatchObject([billing, { ...billing, totalCostMicros: null, rates: null }]);
    expect(calls.map((call) => call.requestId)).toEqual(['legacy:old:0', 'legacy:old:1']);
    expect(calls[0]?.statusCode).toBeNull();
    upgraded.close();
    const reopened = openSqliteDatabase({ dataRoot: root.path });
    handles.push(reopened);
    expect(reopened.client.prepare('SELECT count(*) FROM model_requests').pluck().get()).toBe(2);
  });
  it('rolls back the ledger migration when an old snapshot is invalid (USG-011)', async () => {
    const root = await createTemporaryDataRoot('ledger-rollback-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-ledger', 48);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    legacy.client.exec(
      `INSERT INTO agent_runs (id,agent_key,agent_version,prompt_version,model_config_hash,input_hash,cache_key,status,started_at,model_usage_json) VALUES ('bad','test','1','1','m','i','c','failed',1,'[{}]')`,
    );
    legacy.close();
    expect(() => openSqliteDatabase({ dataRoot: root.path })).toThrow();
    const unchanged = openSqliteDatabase({ dataRoot: root.path, runMigrations: false });
    handles.push(unchanged);
    expect(unchanged.client.prepare('SELECT model_usage_json FROM agent_runs').pluck().get()).toBe(
      '[{}]',
    );
    expect(
      unchanged.client.prepare("SELECT name FROM sqlite_master WHERE name='model_requests'").get(),
    ).toBeUndefined();
  });
  it('adds nullable billing details without changing historical run amounts or output', async () => {
    const root = await createTemporaryDataRoot('billing-upgrade-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-billing', 45);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    legacy.client.exec(`INSERT INTO agent_runs
      (id,agent_key,agent_version,prompt_version,model_config_hash,input_hash,cache_key,status,output_json,input_tokens,output_tokens,estimated_cost_micros,cost_currency,pricing_version,started_at,finished_at)
      VALUES ('old','test','1.0.0','v1','model','input','cache','succeeded','{"ok":true}',4842,13908,9071,'USD','cache-miss-assumed',1,2)`);
    const before = legacy.client
      .prepare('SELECT * FROM agent_runs WHERE id=?')
      .get('old') as Record<string, unknown>;
    legacy.close();
    const upgraded = openSqliteDatabase({ dataRoot: root.path });
    handles.push(upgraded);
    const facts = Object.fromEntries(
      Object.entries(before).filter(([key]) => !['agent_version', 'prompt_version'].includes(key)),
    );
    expect(upgraded.client.prepare('SELECT * FROM agent_runs WHERE id=?').get('old')).toEqual({
      ...facts,
      definition_hash: 'historical:old',
    });
  });
  it('resets legacy application events and rejects the removed activity type', async () => {
    const root = await createTemporaryDataRoot('jobhunter-calendar-activity-upgrade-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-calendar-activity-merge', 43);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    legacy.client
      .prepare(
        `INSERT INTO mail_message_refs (
          id, mailbox_key, provider_key, external_message_key, folder_id, received_at,
          content_version, processing_status, last_seen_at, created_at, updated_at
        ) VALUES ('mail-coding', 'personal', 'imap', 'INBOX:2', 'INBOX', 100,
          '1', 'accepted', 100, 100, 100)`,
      )
      .run();
    legacy.client
      .prepare(
        `INSERT INTO job_applications (
          id, company_name, role_title, status, revision, created_at, updated_at
        ) VALUES ('application-coding', '示例公司', '开发工程师', 'assessment', 1, 100, 100)`,
      )
      .run();
    legacy.client
      .prepare(
        `INSERT INTO application_events (
          id, application_id, sequence_no, mail_message_ref_id, source_content_hash,
          source_event_no, acceptance_kind, classifier_kind, classifier_version,
          event_type, effective_at, received_at, confidence, activity_type,
          deadline_local_date, time_precision, timezone_source, payload_json, created_at
        ) VALUES ('event-coding', 'application-coding', 1, 'mail-coding', ?, 1,
          'automatic', 'agent', 'legacy-agent', 'assessment_invited', 100, 100, 0.9,
          'coding_test', '2026-10-31', 'date_only', 'not_applicable', ?, 100)`,
      )
      .run(
        'c'.repeat(64),
        JSON.stringify({
          schedule: {
            activityType: 'coding_test',
            deadlineLocalDate: '2026-10-31',
          },
        }),
      );
    legacy.close();

    // 1、执行破坏性迁移；2、验证旧事件已清空；3、确认数据库拒绝旧类型。
    const upgraded = openSqliteDatabase({ dataRoot: root.path });
    handles.push(upgraded);
    expect(
      upgraded.client.prepare('SELECT count(*) AS count FROM application_events').get(),
    ).toEqual({ count: 0 });
    expect(() =>
      upgraded.client
        .prepare(
          `INSERT INTO application_events (
            id, application_id, sequence_no, mail_message_ref_id, source_content_hash,
            source_event_no, acceptance_kind, classifier_kind, classifier_version,
            event_type, effective_at, received_at, confidence, activity_type,
            payload_json, created_at
          ) VALUES ('event-coding-new', 'application-coding', 1, 'mail-coding', ?, 1,
            'automatic', 'agent', 'current-agent', 'assessment_invited', 100, 100, 0.9,
            'coding_test', '{}', 100)`,
        )
        .run('d'.repeat(64)),
    ).toThrow();
  });

  it('backfills retry roots and maintains projections for newly inserted retries', async () => {
    const root = await createTemporaryDataRoot('jobhunter-task-projection-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-projection', 32);
    const integrity = vi.spyOn(health, 'assertDatabaseIntegrity');
    const old = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    const insert = `INSERT INTO tasks
      (id, task_type, payload_json, status, idempotency_key, retry_of_task_id,
       max_attempts, available_at, created_at)
      VALUES (?, 'source.job-detail', ?, 'failed', ?, ?, 3, 0, 0)`;
    const payload = JSON.stringify({ sourceId: 'source', runId: 'run' });
    old.client.prepare(insert).run('root', payload, 'root', null);
    old.client.prepare(insert).run('retry', payload, 'retry', 'root');
    old.close();
    const current = openSqliteDatabase({ dataRoot: root.path });
    expect(integrity).toHaveBeenCalledTimes(2);
    handles.push(current);
    current.client
      .prepare(insert.replace('payload_json', 'private_state'))
      .run('retry-again', payload, 'retry-again', 'retry');
    expect(
      current.client
        .prepare('SELECT source_id, source_run_id, retry_root_task_id FROM tasks ORDER BY id')
        .all(),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        source_id: 'source',
        source_run_id: 'run',
        retry_root_task_id: 'root',
      })),
    );
  });

  it('initializes the compact final schema with constraints, WAL and foreign keys', async () => {
    const handle = await openTestDatabase();
    const tables = handle.client
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    for (const required of [
      'companies',
      'source_channels',
      'job_sources',
      'files',
      'entities',
      'file_entity_mappings',
      'source_job_details',
      'events',
      'jobs',
      'job_metadata',
      'job_observations',
      'candidate_profiles',
      'agent_runs',
      'profile_versions',
      'tasks',
      'application_settings',
      'ai_sessions',
      'ai_messages',
      'ai_session_metadata',
      'interview_experiences',
      'interview_question_entries',
      'sync_seen_jobs',
    ]) {
      expect(names).toContain(required);
    }
    for (const removed of [
      'project_dossiers',
      'experience_research_requests',
      'schedules',
      'job_revisions',
      'job_enrichments',
      'match_rulesets',
      'match_results',
      'match_advices',
      'file_artifacts',
      'raw_job_records',
      'job_status_events',
      'resume_documents',
      'experience_documents',
      'resume_polish_suggestions',
      'agent_tool_calls',
      'sync_item_failures',
      'operation_audit_events',
    ]) {
      expect(names).not.toContain(removed);
    }
    expect(names.some((name) => name.startsWith('jobs_fts'))).toBe(false);

    expect(handle.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.client.pragma('busy_timeout', { simple: true })).toBe(2_500);
    await expect(access(handle.databasePath)).resolves.toBeUndefined();

    const insertMaterialFile = handle.client.prepare(
      `INSERT INTO files
       (id, kind, name, state, revision, properties_json, created_at, updated_at)
       VALUES (?, 'project_material', 'architecture.md', 'pending', 0, ?, 1, 1)`,
    );
    const logicalIdentity = JSON.stringify({
      dossierId: '018f0000-0000-7000-8000-000000000080',
      fileName: 'architecture.md',
    });
    insertMaterialFile.run('018f0000-0000-7000-8000-000000000081', logicalIdentity);
    expect(() =>
      insertMaterialFile.run('018f0000-0000-7000-8000-000000000082', logicalIdentity),
    ).toThrow(/unique/iu);
  });

  it('runs a migration only once and preserves existing data', async () => {
    const first = await openTestDatabase();
    first.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 1, 1, 1)`,
      )
      .run('018f0000-0000-7000-8000-000000000001', 'fixture', 'Fixture');
    const dataRoot = first.dataRoot;
    first.close();
    handles.splice(handles.indexOf(first), 1);

    const reopened = openSqliteDatabase({ dataRoot });
    handles.push(reopened);
    expect(
      reopened.client.prepare('SELECT name FROM companies WHERE slug = ?').pluck().get('fixture'),
    ).toBe('Fixture');
    expect(reopened.client.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(
      61,
    );
  });

  it('expands provider isolation without changing the existing BOSS connection', async () => {
    const root = await createTemporaryDataRoot('platform-provider-upgrade-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-provider-isolation', 35);
    const legacy = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    legacy.client
      .prepare("INSERT INTO platform_connections VALUES ('boss',7,'available',123)")
      .run();
    legacy.close();
    const upgraded = openSqliteDatabase({ dataRoot: root.path });
    handles.push(upgraded);
    expect(
      upgraded.client.prepare("SELECT * FROM platform_connections WHERE provider_key='boss'").get(),
    ).toEqual({ provider_key: 'boss', generation: 7, status: 'available', updated_at: 123 });
    for (const key of ['zhilian', '51job', 'liepin'])
      upgraded.client
        .prepare("INSERT INTO platform_connections VALUES (?,1,'disconnected',123)")
        .run(key);
    expect(() =>
      upgraded.client
        .prepare("INSERT INTO platform_connections VALUES ('unknown',1,'disconnected',123)")
        .run(),
    ).toThrow();
    expect(upgraded.client.pragma('foreign_key_check')).toEqual([]);
  });

  it('destructively resets legacy cleanup schedule payloads to current defaults', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-cleanup-schedule-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-cleanup-schedule-reset',
      24,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client
      .prepare(
        `INSERT INTO schedules
         (id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
          next_run_at, last_enqueued_at, created_at, updated_at)
         VALUES (?, 'maintenance.cleanup:weekly', 'maintenance.cleanup', ?, '0 4 * * 0',
                 'Asia/Shanghai', 1, 1, NULL, 1, 1)`,
      )
      .run(
        '018f0000-0000-7000-8000-000000000401',
        JSON.stringify({ rawRecordsDays: 7, observationsDays: 8, failedAgentRunsDays: 9 }),
      );
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    const payload = upgraded.client
      .prepare(
        `SELECT payload_json FROM ${periodicConfigProjection} WHERE schedule_key = 'maintenance.cleanup:weekly'`,
      )
      .pluck()
      .get() as string;
    expect(JSON.parse(payload)).toEqual({
      sourceDetailsDays: 30,
      observationsDays: 90,
      failedAgentRunsDays: 30,
    });
  });

  it('destructively projects legacy sync run statistics to the current shape', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-sync-stats-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-sync-stats-reset',
      25,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('stats-company', 'stats-company', 'Stats Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('stats-channel', 'stats-company', 'social', 'stats-company-social', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('stats-source', 'stats-company', 'stats-channel', 'stats-source', 'stats.source',
              'https://example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy', 0, 1, 1);
      INSERT INTO sync_runs
        (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
         sync_policy_version, source_config_hash, stats_json, started_at)
      VALUES ('stats-run', 'stats-source', 'manual', 'running', 'unknown', 'v1', 'v1',
              'v1', '${'0'.repeat(64)}', '{}', 1),
             ('stats-run-legacy', 'stats-source', 'manual', 'succeeded', 'complete', 'v1', 'v1',
              'v1', '${'1'.repeat(64)}',
              '{"discovered":3,"created":1,"unchanged":2,"rawStored":3}', 2);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    const payload = upgraded.client
      .prepare("SELECT json_extract(public_state,'$.stats') FROM tasks WHERE id = 'stats-run'")
      .pluck()
      .get() as string;
    expect(JSON.parse(payload)).toEqual({
      discovered: 0,
      created: 0,
      revised: 0,
      unchanged: 0,
      skippedNonDomestic: 0,
      skippedOutOfScope: 0,
      skippedUnknownRegion: 0,
      isolated: 0,
      restored: 0,
      staled: 0,
      closed: 0,
      followupEnqueued: 0,
    });
    const legacyPayload = upgraded.client
      .prepare(
        "SELECT json_extract(public_state,'$.stats') FROM tasks WHERE id = 'stats-run-legacy'",
      )
      .pluck()
      .get() as string;
    expect(JSON.parse(legacyPayload)).toEqual({
      discovered: 3,
      created: 1,
      revised: 0,
      unchanged: 2,
      skippedNonDomestic: 0,
      skippedOutOfScope: 0,
      skippedUnknownRegion: 0,
      isolated: 0,
      restored: 0,
      staled: 0,
      closed: 0,
      followupEnqueued: 0,
    });
  });

  it('retains the latest five profile versions and removes obsolete match derivations', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-profile-retention-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-profile-retention',
      27,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('retention-profile', 'Candidate', 1, 7);
      INSERT INTO profile_versions
        (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
         content_hash, is_current, created_at)
      VALUES
        ('retention-version-1', 'retention-profile', 1, '{}', '{}', '[]', 'hash-1', 0, 1),
        ('retention-version-2', 'retention-profile', 2, '{}', '{}', '[]', 'hash-2', 0, 2),
        ('retention-version-3', 'retention-profile', 3, '{}', '{}', '[]', 'hash-3', 0, 3),
        ('retention-version-4', 'retention-profile', 4, '{}', '{}', '[]', 'hash-4', 0, 4),
        ('retention-version-5', 'retention-profile', 5, '{}', '{}', '[]', 'hash-5', 0, 5),
        ('retention-version-6', 'retention-profile', 6, '{}', '{}', '[]', 'hash-6', 0, 6),
        ('retention-version-7', 'retention-profile', 7, '{}', '{}', '[]', 'hash-7', 1, 7);
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('retention-company', 'retention-company', 'Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('retention-channel', 'retention-company', 'social', 'retention-channel', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, coverage_role, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('retention-source', 'retention-company', 'retention-channel', 'retention-source',
              'retention.source', 'required', 'https://example.com', '{}', 'v1', '{}', 1,
              'supported', 'healthy', 0, 1, 1);
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, locations_json, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at, last_seen_at,
         created_at, updated_at)
      VALUES ('retention-job', 'retention-company', 'retention-source', 'job', 'Engineer', '[]',
              'Build systems', 'https://example.com/job', 'https://example.com/job', 'active', 0,
              'job-hash', 1, 1, 1, 1);
      INSERT INTO job_revisions
        (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
         source_url, snapshot_json, change_set_json, created_at)
      VALUES ('retention-revision', 'retention-job', 1, 'revision-hash', 'v1',
              '${'a'.repeat(64)}', 'https://example.com/job', '{}', '[]', 1);
      INSERT INTO match_rulesets
        (id, version, definition_json, definition_hash, active, created_at)
      VALUES ('retention-ruleset', 'retention-v1', '{}', 'retention-rules-hash', 1, 1);
      INSERT INTO match_results
        (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
         components_json, risks_json, input_hash, created_at)
      VALUES ('retention-match', 'retention-version-1', 'retention-revision',
              'retention-ruleset', 'eligible', 80, '[]', '[]', 'retention-input-hash', 1);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(
      upgraded.client
        .prepare(
          `SELECT version_no FROM profile_versions
           WHERE profile_id = 'retention-profile' ORDER BY version_no DESC`,
        )
        .pluck()
        .all(),
    ).toEqual([7, 6, 5, 4, 3]);
    expect(
      upgraded.client
        .prepare("SELECT count(*) FROM job_metadata WHERE id = 'retention-match'")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('migrates existing sync work to one active recruitment channel', async () => {
    const root = await createTemporaryDataRoot('jobhunter-legacy-channel-');
    dataRoots.push(root);
    const folder = await migrationsBefore(root.path, 'before-periodic-settings', 54);
    const handle = openSqliteDatabase({ dataRoot: root.path, migrationsFolder: folder });
    handles.push(handle);
    const companyId = '018f0000-0000-7000-8000-000000000901';
    const internChannelId = '018f0000-0000-7000-8200-000000010901';
    const socialChannelId = '018f0000-0000-7000-8200-000000010903';
    const internSourceId = '018f0000-0000-7000-8000-000000000901';
    const socialSourceId = '018f0000-0000-7000-8000-000000000903';
    handle.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'single-channel-fixture', 'Single channel fixture', '[]', 1, 1, 1)`,
      )
      .run(companyId);
    const insertChannel = handle.client.prepare(
      `INSERT INTO source_channels
       (id, company_id, channel, slug, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 1)`,
    );
    insertChannel.run(internChannelId, companyId, 'intern', 'single-channel-fixture-intern');
    insertChannel.run(socialChannelId, companyId, 'social', 'single-channel-fixture-social');
    const insertSource = handle.client.prepare(
      `INSERT INTO job_sources
       (id, company_id, channel_id, slug, adapter_key, coverage_role, base_url,
        config_json, sync_policy_version, sync_policy_json, enabled,
        support_status, health_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'required', 'https://example.com', '{}', 'v1', '{}', 1,
               'supported', 'unknown', 1, 1)`,
    );
    insertSource.run(
      internSourceId,
      companyId,
      internChannelId,
      'single-channel-fixture-intern',
      'fixture.intern',
    );
    insertSource.run(
      socialSourceId,
      companyId,
      socialChannelId,
      'single-channel-fixture-social',
      'fixture.social',
    );
    const insertSchedule = handle.client.prepare(
      `INSERT INTO schedules
       (id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
        next_run_at, created_at, updated_at)
       VALUES (?, ?, 'source.sync', ?, '0 9 * * *', 'Asia/Shanghai', 1, 1, 1, 1)`,
    );
    insertSchedule.run(
      'schedule-intern',
      `source.sync:${internSourceId}`,
      JSON.stringify({ sourceId: internSourceId, trigger: 'schedule' }),
    );
    insertSchedule.run(
      'schedule-social',
      `source.sync:${socialSourceId}`,
      JSON.stringify({ sourceId: socialSourceId, trigger: 'schedule' }),
    );
    const insertTask = handle.client.prepare(
      `INSERT INTO tasks
       (id, task_type, payload_json, status, idempotency_key, max_attempts,
        available_at, created_at)
       VALUES (?, 'source.sync', ?, 'pending', ?, 3, 1, 1)`,
    );
    insertTask.run(
      'task-intern',
      JSON.stringify({ sourceId: internSourceId, trigger: 'manual' }),
      'task-intern',
    );
    insertTask.run(
      'task-social',
      JSON.stringify({ sourceId: socialSourceId, trigger: 'manual' }),
      'task-social',
    );

    const migration = await readFile(
      new URL('../migrations/legacy/0016_single_active_source_channel.sql', import.meta.url),
      'utf8',
    );
    handle.client
      .prepare("DELETE FROM application_settings WHERE key = 'sources.activeChannel'")
      .run();
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) handle.client.exec(statement);
    }

    expect(
      handle.client
        .prepare("SELECT value_json FROM application_settings WHERE key = 'sources.activeChannel'")
        .pluck()
        .get(),
    ).toBe('{"channel":"intern"}');
    expect(
      handle.client
        .prepare(
          `SELECT channel, enabled FROM source_channels
           WHERE company_id = ? ORDER BY channel`,
        )
        .all(companyId),
    ).toEqual([
      { channel: 'intern', enabled: 1 },
      { channel: 'social', enabled: 0 },
    ]);
    expect(handle.client.prepare('SELECT id, enabled FROM schedules ORDER BY id').all()).toEqual([
      { id: 'schedule-intern', enabled: 1 },
      { id: 'schedule-social', enabled: 0 },
    ]);
    expect(handle.client.prepare('SELECT id, status FROM tasks ORDER BY id').all()).toEqual([
      { id: 'task-intern', status: 'pending' },
      { id: 'task-social', status: 'cancelled' },
    ]);
  });

  it('upgrades the minimal previous-schema fixture without losing its data', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-upgrade-');
    dataRoots.push(dataRoot);
    const databasePath = path.join(dataRoot.path, 'jobhunter.sqlite');
    const previous = new Database(databasePath);
    try {
      previous.exec(await readFile(new URL('./fixtures/schema-v0.sql', import.meta.url), 'utf8'));
    } finally {
      previous.close();
    }

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(
      upgraded.client
        .prepare("SELECT value FROM legacy_metadata WHERE key = 'fixture'")
        .pluck()
        .get(),
    ).toBe('preserved');
    expect(
      upgraded.client
        .prepare("SELECT count(*) FROM sqlite_master WHERE name = 'jobs'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('converges an existing 0018 database without losing business files or job provenance', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-storage-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-storage-convergence',
      19,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO file_artifacts
        (id, kind, relative_path, media_type, sha256, byte_size, created_at)
      VALUES
        ('resume-artifact', 'resume', 'artifacts/resume', 'text/plain', '${'a'.repeat(64)}', 6, 1),
        ('experience-artifact', 'export', 'artifacts/experience', 'text/plain', '${'b'.repeat(64)}', 10, 2);
      INSERT INTO resume_documents
        (id, artifact_id, content_hash, media_type, extracted_text, parse_status,
         parser_version, created_at)
      VALUES ('resume-file', 'resume-artifact', '${'a'.repeat(64)}', 'text/plain',
              'resume', 'parsed', 'text@1', 1);
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('profile', 'Candidate', 1, 1);
      INSERT INTO profile_versions
        (id, profile_id, version_no, resume_document_id, extracted_json, effective_json,
         locked_paths_json, content_hash, is_current, created_at)
      VALUES ('profile-version', 'profile', 1, 'resume-file', '{}', '{}', '[]',
              '${'c'.repeat(64)}', 1, 1);
      INSERT INTO experience_documents
        (id, artifact_id, content_hash, file_name, media_type, source_mode, extracted_text,
         normalized_text, parser_version, template_version, status, warnings_json, revision,
         created_at, updated_at)
      VALUES ('experience-file', 'experience-artifact', '${'b'.repeat(64)}', 'experience.txt',
              'text/plain', 'upload', 'question answer', 'question answer', 'experience@1',
              'personal-experience@v1', 'accepted', '[]', 1, 2, 3);
      INSERT INTO interview_experiences
        (id, document_id, sequence_no, company, role, tags_json)
      VALUES ('experience', 'experience-file', 1, 'Example', 'Engineer', '[]');
      INSERT INTO interview_question_entries
        (id, experience_id, sequence_no, question, answer)
      VALUES ('question', 'experience', 1, 'Why?', 'Because.');

      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('company', 'upgrade-company', 'Upgrade Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('channel', 'company', 'social', 'upgrade-company-social', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, coverage_role, recruitment_type,
         base_url, config_json, sync_policy_version, sync_policy_json, enabled, support_status,
         health_status, consecutive_failures, created_at, updated_at)
      VALUES ('source', 'company', 'channel', 'upgrade-source', 'upgrade.source', 'required',
              'social', 'https://example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy',
              0, 1, 1);
      INSERT INTO sync_runs
        (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
         sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
      VALUES ('sync', 'source', 'manual', 'succeeded', 'complete', '1', '1', 'v1',
              '${'d'.repeat(64)}', '{}', 1, 2);
      INSERT INTO raw_job_records
        (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
         content_hash, payload_json, captured_at)
      VALUES ('raw', 'source', 'sync', 'external-job', 'external-job',
              'https://example.com/jobs/external-job', '${'e'.repeat(64)}', '{"private":true}', 1);
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, locations_json, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at, last_seen_at,
         created_at, updated_at)
      VALUES ('job', 'company', 'source', 'external-job', 'Engineer', '[]', 'Build systems',
              'https://example.com/jobs/external-job', 'https://example.com/jobs/external-job',
              'active', 0, '${'f'.repeat(64)}', 1, 1, 1, 1);
      INSERT INTO job_revisions
        (id, job_id, revision_no, content_hash, normalizer_version, snapshot_json,
         change_set_json, raw_record_id, created_at)
      VALUES ('revision', 'job', 1, '${'f'.repeat(64)}', '1', '{}', '[]', 'raw', 1);
      INSERT INTO job_observations (job_id, sync_run_id, raw_record_id, observed_at)
      VALUES ('job', 'sync', 'raw', 1);
      INSERT INTO job_status_events
        (id, job_id, sync_run_id, from_status, to_status, reason_code, evidence_json, created_at)
      VALUES ('status-event', 'job', 'sync', NULL, 'active', 'discovered',
              '{"rawRecordId":"raw","kept":true}', 1);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(upgraded.client.prepare('SELECT id, kind, state FROM files ORDER BY id').all()).toEqual([
      { id: 'experience-file', kind: 'interview_experience', state: 'accepted' },
      { id: 'resume-file', kind: 'resume', state: 'parsed' },
    ]);
    expect(
      upgraded.client
        .prepare(
          `SELECT file_id, entity_id, parser_version, parse_status
           FROM file_entity_mappings ORDER BY file_id`,
        )
        .all(),
    ).toEqual([
      {
        file_id: 'experience-file',
        entity_id: 'experience-artifact',
        parser_version: 'experience@1',
        parse_status: 'parsed',
      },
      {
        file_id: 'resume-file',
        entity_id: 'resume-artifact',
        parser_version: 'text@1',
        parse_status: 'parsed',
      },
    ]);
    expect(
      upgraded.client
        .prepare('SELECT resume_file_id FROM profile_versions WHERE id = ?')
        .pluck()
        .get('profile-version'),
    ).toBe('resume-file');
    expect(
      upgraded.client
        .prepare(
          `SELECT file_id, source_type, review_status, research_task_id, verification_status
           FROM interview_experiences WHERE id = ?`,
        )
        .get('experience'),
    ).toEqual({
      file_id: 'experience-file',
      source_type: 'personal',
      review_status: 'accepted',
      research_task_id: null,
      verification_status: 'not_applicable',
    });
    expect(
      upgraded.client
        .prepare(
          `SELECT answer, answer_excerpt, topics_json, question_fingerprint
           FROM interview_question_entries WHERE id = ?`,
        )
        .get('question'),
    ).toEqual({
      answer: 'Because.',
      answer_excerpt: null,
      topics_json: '[]',
      question_fingerprint: null,
    });
    expect(
      (
        upgraded.client.prepare("PRAGMA table_info('interview_question_entries')").all() as {
          readonly name: string;
        }[]
      ).some((column) => column.name === 'evidence_excerpt'),
    ).toBe(false);
    expect(
      upgraded.client
        .prepare(`SELECT source_payload_hash, source_url FROM jobs WHERE content_id = 'revision'`)
        .get(),
    ).toEqual({
      source_payload_hash: 'e'.repeat(64),
      source_url: 'https://example.com/jobs/external-job',
    });
    expect(
      upgraded.client
        .prepare('SELECT job_id FROM job_observations WHERE job_id = ?')
        .pluck()
        .get('job'),
    ).toBe('job');
    const eventPayload = upgraded.client
      .prepare("SELECT payload_json FROM events WHERE event_type = 'job.status.changed'")
      .pluck()
      .get() as string;
    expect(JSON.parse(eventPayload)).toMatchObject({ evidence: { kept: true } });
    expect(eventPayload).not.toContain('rawRecordId');
    expect(
      upgraded.client
        .prepare(
          `SELECT count(*) FROM sqlite_master
           WHERE name IN ('raw_job_records', 'file_artifacts', 'resume_documents',
                          'experience_documents', 'jobs_fts')`,
        )
        .pluck()
        .get(),
    ).toBe(0);
    expect(upgraded.client.pragma('foreign_key_check')).toEqual([]);
  });

  it('uses the logical channel as the only recruitment classification', async () => {
    const handle = await openTestDatabase();
    const columns = handle.client.pragma('table_info(job_sources)') as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('recruitment_type');
    handle.client.exec(`
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('classification-company', 'classification-company', 'Classification', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('classification-channel', 'classification-company', 'intern',
              'classification-company-intern', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('classification-source', 'classification-company', 'classification-channel',
              'classification-source', 'classification.source', 'https://example.com', '{}',
              'v1', '{}', 1, 'supported', 'unknown', 0, 1, 1);
    `);
    expect(
      handle.client
        .prepare(
          `SELECT channel.channel
           FROM job_sources source
           JOIN source_channels channel ON channel.id = source.channel_id
           WHERE source.id = 'classification-source'`,
        )
        .pluck()
        .get(),
    ).toBe('intern');
  });

  it('adds logical channels without rewriting physical source history', async () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      database.exec(`
        CREATE TABLE companies (
          id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, enabled integer NOT NULL
        );
        CREATE TABLE job_sources (
          id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
          slug text NOT NULL UNIQUE, adapter_key text NOT NULL, recruitment_type text NOT NULL,
          base_url text NOT NULL, support_status text NOT NULL, support_note text
        );
        CREATE TABLE sync_runs (
          id text PRIMARY KEY, source_id text NOT NULL REFERENCES job_sources(id)
        );
        CREATE TABLE jobs (
          id text PRIMARY KEY, source_id text NOT NULL REFERENCES job_sources(id)
        );
        CREATE TABLE tasks (id text PRIMARY KEY, payload_json text NOT NULL);
        INSERT INTO companies VALUES (
          '018f0000-0000-7000-8000-000000000101', 'tencent', '腾讯', 1
        );
        INSERT INTO job_sources VALUES (
          '018f0000-0000-7000-8000-000000000201',
          '018f0000-0000-7000-8000-000000000101',
          'tencent-social', 'tencent.social', 'social',
          'https://careers.tencent.com', 'supported', NULL
        );
        INSERT INTO sync_runs VALUES ('run-1', '018f0000-0000-7000-8000-000000000201');
        INSERT INTO jobs VALUES ('job-1', '018f0000-0000-7000-8000-000000000201');
        INSERT INTO tasks VALUES (
          'task-1', '{"sourceId":"018f0000-0000-7000-8000-000000000201"}'
        );
      `);
      const migration = await readFile(
        new URL('../migrations/legacy/0015_logical_source_channels.sql', import.meta.url),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) database.exec(statement);
      }

      expect(
        database.prepare('SELECT id, channel_id, coverage_role FROM job_sources').get(),
      ).toEqual({
        id: '018f0000-0000-7000-8000-000000000201',
        channel_id: '018f0000-0000-7000-8200-000000010103',
        coverage_role: 'required',
      });
      expect(database.prepare('SELECT source_id FROM sync_runs').pluck().get()).toBe(
        '018f0000-0000-7000-8000-000000000201',
      );
      expect(database.prepare('SELECT source_id FROM jobs').pluck().get()).toBe(
        '018f0000-0000-7000-8000-000000000201',
      );
      expect(database.prepare('SELECT payload_json FROM tasks').pluck().get()).toBe(
        '{"sourceId":"018f0000-0000-7000-8000-000000000201"}',
      );
      expect(database.pragma('foreign_key_check')).toEqual([]);
      expect(() =>
        database
          .prepare(
            `INSERT INTO job_sources
             (id, company_id, channel_id, slug, adapter_key, recruitment_type,
              base_url, support_status)
             VALUES ('invalid', '018f0000-0000-7000-8000-000000000101', NULL,
                     'invalid', 'invalid', 'social', 'https://example.com', 'blocked')`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('does not create FTS tables or synchronization triggers', async () => {
    const handle = await openTestDatabase();
    expect(
      handle.client
        .prepare(
          `SELECT count(*) FROM sqlite_master
           WHERE name LIKE 'jobs_fts%' OR name LIKE 'jobs_a%' OR name LIKE 'jobs_d%'`,
        )
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('rolls back a failed transaction without partial rows', async () => {
    const handle = await openTestDatabase();
    const transaction = handle.client.transaction(() => {
      handle.client
        .prepare(
          `INSERT INTO companies
           (id, slug, name, aliases_json, enabled, created_at, updated_at)
           VALUES ('018f0000-0000-7000-8000-000000000001', 'rollback', 'Rollback', '[]', 1, 1, 1)`,
        )
        .run();
      handle.client.prepare('INSERT INTO companies (id) VALUES (?)').run('invalid-row');
    });

    expect(transaction).toThrow();
    expect(
      handle.client.prepare("SELECT count(*) FROM companies WHERE slug = 'rollback'").pluck().get(),
    ).toBe(0);
  });

  it('applies busy_timeout when a second writer is blocked', async () => {
    const first = await openTestDatabase();
    const second = openSqliteDatabase({ dataRoot: first.dataRoot, busyTimeoutMs: 100 });
    handles.push(second);
    first.client.exec('BEGIN IMMEDIATE');
    const started = performance.now();
    try {
      expect(() => {
        second.client
          .prepare(
            `INSERT INTO companies
             (id, slug, name, aliases_json, enabled, created_at, updated_at)
             VALUES ('018f0000-0000-7000-8000-000000000070', 'busy', 'Busy', '[]', 1, 1, 1)`,
          )
          .run();
      }).toThrow(/locked|busy/i);
      expect(performance.now() - started).toBeGreaterThanOrEqual(75);
    } finally {
      first.client.exec('ROLLBACK');
    }
  });

  it('uses only the configured temporary data root', async () => {
    const handle = await openTestDatabase();
    expect(path.resolve(handle.dataRoot)).not.toBe(path.resolve('var'));
    expect(path.dirname(handle.databasePath)).toBe(path.resolve(handle.dataRoot));
  });
});
