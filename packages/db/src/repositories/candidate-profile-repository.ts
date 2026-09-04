import type {
  AppendProfileVersionResult,
  CandidateProfileRecord,
  CandidateProfileRepository,
  ProfileVersionRecord,
} from '@jobhunter/application';
import {
  parseCandidateProfile,
  parseContentHash,
  parseId,
  type CandidateProfileId,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';

/** 数据库查询结果对应的行结构。 */
interface ProfileRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface VersionRow {
  readonly id: string;
  readonly profile_id: string;
  readonly version_no: number;
  readonly resume_document_id: string | null;
  readonly agent_run_id: string | null;
  readonly extracted_json: string;
  readonly effective_json: string;
  readonly locked_paths_json: string;
  readonly content_hash: string;
  readonly is_current: number;
  readonly created_at: number;
}

const maximumRetainedProfileVersions = 5;

const versionSelection = `SELECT id, profile_id, version_no,
                                 resume_file_id AS resume_document_id, agent_run_id,
                                 extracted_json, effective_json, locked_paths_json, content_hash,
                                 is_current, created_at
                          FROM profile_versions`;

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function profileRecord(row: ProfileRow): CandidateProfileRecord {
  return {
    id: parseId(row.id, 'CandidateProfile'),
    name: row.name,
    createdAt: row.created_at as CandidateProfileRecord['createdAt'],
    updatedAt: row.updated_at as CandidateProfileRecord['updatedAt'],
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function versionRecord(row: VersionRow): ProfileVersionRecord {
  const locked = JSON.parse(row.locked_paths_json) as unknown;
  if (!Array.isArray(locked) || !locked.every((value) => typeof value === 'string')) {
    throw new TypeError('Stored profile locked paths are invalid.');
  }
  return {
    id: parseId(row.id, 'ProfileVersion'),
    profileId: parseId(row.profile_id, 'CandidateProfile'),
    versionNo: row.version_no,
    resumeDocumentId: row.resume_document_id,
    agentRunId: row.agent_run_id,
    extracted: parseCandidateProfile(JSON.parse(row.extracted_json) as unknown),
    effective: parseCandidateProfile(JSON.parse(row.effective_json) as unknown),
    lockedPaths: locked,
    contentHash: parseContentHash(row.content_hash),
    isCurrent: row.is_current === 1,
    createdAt: row.created_at as ProfileVersionRecord['createdAt'],
  };
}

/** 持久化候选人简历档案、版本及当前版本指针。 */
export class SqliteCandidateProfileRepository implements CandidateProfileRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createProfile(profile: CandidateProfileRecord): CandidateProfileRecord {
    this.#client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(profile.id, profile.name, profile.createdAt, profile.updatedAt);
    return profile;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listProfiles(): readonly CandidateProfileRecord[] {
    const rows = this.#client
      .prepare(
        'SELECT id, name, created_at, updated_at FROM candidate_profiles ORDER BY created_at, id',
      )
      .all() as ProfileRow[];
    return rows.map(profileRecord);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getProfile(profileId: CandidateProfileId): CandidateProfileRecord | null {
    const row = this.#client
      .prepare('SELECT id, name, created_at, updated_at FROM candidate_profiles WHERE id = ?')
      .get(profileId) as ProfileRow | undefined;
    return row ? profileRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getCurrentVersion(profileId: CandidateProfileId): ProfileVersionRecord | null {
    const row = this.#client
      .prepare(`${versionSelection} WHERE profile_id = ? AND is_current = 1`)
      .get(profileId) as VersionRow | undefined;
    return row ? versionRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getVersion(versionId: ProfileVersionRecord['id']): ProfileVersionRecord | null {
    const row = this.#client.prepare(`${versionSelection} WHERE id = ?`).get(versionId) as
      VersionRow | undefined;
    return row ? versionRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listVersions(profileId: CandidateProfileId): readonly ProfileVersionRecord[] {
    const rows = this.#client
      .prepare(`${versionSelection} WHERE profile_id = ? ORDER BY version_no DESC`)
      .all(profileId) as VersionRow[];
    return rows.map(versionRecord);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public appendVersion(input: {
    readonly expectedCurrentVersionId: ProfileVersionRecord['id'] | null;
    readonly version: ProfileVersionRecord;
  }): AppendProfileVersionResult {
    return this.#client.transaction(() => {
      const current = this.getCurrentVersion(input.version.profileId);
      if ((current?.id ?? null) !== input.expectedCurrentVersionId) {
        return { kind: 'conflict', currentVersionId: current?.id ?? null } as const;
      }
      if (current) {
        this.#client
          .prepare('UPDATE profile_versions SET is_current = 0 WHERE id = ? AND is_current = 1')
          .run(current.id);
      }
      const version = input.version;
      this.#client
        .prepare(
          `INSERT INTO profile_versions
             (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
              effective_json, locked_paths_json, content_hash, is_current, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          version.id,
          version.profileId,
          version.versionNo,
          version.resumeDocumentId,
          version.agentRunId,
          JSON.stringify(version.extracted),
          JSON.stringify(version.effective),
          JSON.stringify(version.lockedPaths),
          version.contentHash,
          version.createdAt,
        );
      this.#client
        .prepare('UPDATE candidate_profiles SET updated_at = ? WHERE id = ?')
        .run(version.createdAt, version.profileId);
      const obsoleteVersionIds = this.#client
        .prepare(
          `SELECT id FROM profile_versions
           WHERE profile_id = ?
           ORDER BY version_no DESC, id DESC
           LIMIT -1 OFFSET ?`,
        )
        .pluck()
        .all(version.profileId, maximumRetainedProfileVersions) as string[];
      if (obsoleteVersionIds.length > 0) {
        const placeholders = obsoleteVersionIds.map(() => '?').join(', ');
        this.#client
          .prepare(`DELETE FROM match_results WHERE profile_version_id IN (${placeholders})`)
          .run(...obsoleteVersionIds);
        this.#client
          .prepare(`DELETE FROM profile_versions WHERE id IN (${placeholders})`)
          .run(...obsoleteVersionIds);
      }
      return { kind: 'created', version } as const;
    })();
  }
}
