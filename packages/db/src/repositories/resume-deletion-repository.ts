import type {
  QuarantinedArtifact,
  ResumeDeletionRepository,
  ResumeDeletionSnapshot,
} from '@jobhunter/application';
import { canonicalJson, type UtcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function sortedStrings(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function selectStrings(
  client: Database.Database,
  sql: string,
  parameters: readonly string[],
): readonly string[] {
  return sortedStrings(
    (client.prepare(sql).all(...parameters) as { readonly id: string }[]).map((row) => row.id),
  );
}

function sameSnapshot(left: ResumeDeletionSnapshot, right: ResumeDeletionSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ResumeDeletionImpactChangedError extends Error {
  public constructor() {
    super('Resume deletion impact changed after confirmation.');
    this.name = 'ResumeDeletionImpactChangedError';
  }
}

export class SqliteResumeDeletionRepository implements ResumeDeletionRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public preview(resumeDocumentId: string): ResumeDeletionSnapshot | null {
    const document = this.#client
      .prepare("SELECT id FROM files WHERE id = ? AND kind = 'resume'")
      .get(resumeDocumentId);
    if (!document) return null;

    const profiles = new Set<string>(
      selectStrings(
        this.#client,
        'SELECT DISTINCT profile_id AS id FROM profile_versions WHERE resume_file_id = ?',
        [resumeDocumentId],
      ),
    );

    // Cached successful Agent runs may be referenced by more than one profile. Expand the
    // closure so deleting one resume cannot leave the same structured resume facts behind.
    let changed = true;
    while (changed && profiles.size > 0) {
      changed = false;
      const profileIds = sortedStrings(profiles);
      const agentRunIds = selectStrings(
        this.#client,
        `SELECT DISTINCT agent_run_id AS id FROM profile_versions
         WHERE profile_id IN (${placeholders(profileIds.length)}) AND agent_run_id IS NOT NULL`,
        profileIds,
      );
      if (agentRunIds.length === 0) break;
      const sharedProfiles = selectStrings(
        this.#client,
        `SELECT DISTINCT profile_id AS id FROM profile_versions
         WHERE agent_run_id IN (${placeholders(agentRunIds.length)})`,
        agentRunIds,
      );
      for (const profileId of sharedProfiles) {
        if (!profiles.has(profileId)) {
          profiles.add(profileId);
          changed = true;
        }
      }
    }

    const profileIds = sortedStrings(profiles);
    const profileVersionIds =
      profileIds.length === 0
        ? []
        : selectStrings(
            this.#client,
            `SELECT id FROM profile_versions WHERE profile_id IN (${placeholders(profileIds.length)})`,
            profileIds,
          );
    const resumeDocumentIds = new Set<string>([resumeDocumentId]);
    if (profileIds.length > 0) {
      for (const id of selectStrings(
        this.#client,
        `SELECT DISTINCT resume_file_id AS id FROM profile_versions
         WHERE profile_id IN (${placeholders(profileIds.length)})
           AND resume_file_id IS NOT NULL`,
        profileIds,
      )) {
        resumeDocumentIds.add(id);
      }
    }
    const sortedDocumentIds = sortedStrings(resumeDocumentIds);
    const matchResultIds =
      profileVersionIds.length === 0
        ? []
        : selectStrings(
            this.#client,
            `SELECT id FROM match_results
             WHERE profile_version_id IN (${placeholders(profileVersionIds.length)})`,
            profileVersionIds,
          );
    const agentRuns = new Set<string>();
    if (profileVersionIds.length > 0) {
      for (const id of selectStrings(
        this.#client,
        `SELECT DISTINCT agent_run_id AS id FROM profile_versions
         WHERE id IN (${placeholders(profileVersionIds.length)}) AND agent_run_id IS NOT NULL`,
        profileVersionIds,
      )) {
        agentRuns.add(id);
      }
    }
    if (matchResultIds.length > 0) {
      for (const id of selectStrings(
        this.#client,
        `SELECT DISTINCT agent_run_id AS id FROM match_advices
         WHERE match_result_id IN (${placeholders(matchResultIds.length)})`,
        matchResultIds,
      )) {
        agentRuns.add(id);
      }
    }
    const resumeDraftIds =
      profileIds.length === 0
        ? []
        : selectStrings(
            this.#client,
            `SELECT id FROM resume_template_drafts
       WHERE profile_id IN (${placeholders(profileIds.length)})`,
            profileIds,
          );
    const resumeExportRequestIds =
      resumeDraftIds.length === 0
        ? []
        : selectStrings(
            this.#client,
            `SELECT id FROM resume_export_requests
       WHERE draft_id IN (${placeholders(resumeDraftIds.length)})`,
            resumeDraftIds,
          );
    const resumeDraftFileIds =
      resumeDraftIds.length === 0
        ? []
        : selectStrings(
            this.#client,
            `SELECT id FROM (
         SELECT avatar_file_id AS id FROM resume_template_drafts
         WHERE id IN (${placeholders(resumeDraftIds.length)}) AND avatar_file_id IS NOT NULL
         UNION SELECT input_file_id AS id FROM resume_export_requests
         WHERE draft_id IN (${placeholders(resumeDraftIds.length)})
         UNION SELECT output_file_id AS id FROM resume_export_requests
         WHERE draft_id IN (${placeholders(resumeDraftIds.length)}) AND output_file_id IS NOT NULL
       )`,
            [...resumeDraftIds, ...resumeDraftIds, ...resumeDraftIds],
          );
    const allFileIds = sortedStrings([...sortedDocumentIds, ...resumeDraftFileIds]);
    const artifactRows = this.#client
      .prepare(
        `SELECT DISTINCT entity.id, entity.relative_path
         FROM file_entity_mappings version
         JOIN entities entity ON entity.id = version.entity_id
         WHERE version.file_id IN (${placeholders(allFileIds.length)})
           AND NOT EXISTS (
             SELECT 1 FROM file_entity_mappings other
             WHERE other.entity_id = entity.id
               AND other.file_id NOT IN (${placeholders(allFileIds.length)})
           )
         ORDER BY entity.id`,
      )
      .all(...allFileIds, ...allFileIds) as {
      readonly id: string;
      readonly relative_path: string;
    }[];

    return {
      requestedResumeDocumentId: resumeDocumentId,
      profileIds,
      profileVersionIds,
      resumeDocumentIds: sortedDocumentIds,
      matchResultIds,
      agentRunIds: sortedStrings(agentRuns),
      resumeDraftIds,
      resumeExportRequestIds,
      resumeDraftFileIds,
      artifacts: artifactRows.map((row) => ({ id: row.id, relativePath: row.relative_path })),
    };
  }

  public applyConfirmedDeletion(input: {
    readonly expected: ResumeDeletionSnapshot;
    readonly quarantinedArtifacts: readonly QuarantinedArtifact[];
    readonly deletedAt: UtcInstant;
    readonly audit: Parameters<ResumeDeletionRepository['applyConfirmedDeletion']>[0]['audit'];
  }): void {
    this.#client.transaction(() => {
      const current = this.preview(input.expected.requestedResumeDocumentId);
      if (!current || !sameSnapshot(current, input.expected)) {
        throw new ResumeDeletionImpactChangedError();
      }
      const quarantineById = new Map(
        input.quarantinedArtifacts.map((artifact) => [artifact.artifactId, artifact]),
      );
      for (const artifact of current.artifacts) {
        const quarantined = quarantineById.get(artifact.id);
        if (quarantined?.originalRelativePath !== artifact.relativePath) {
          throw new ResumeDeletionImpactChangedError();
        }
        this.#client
          .prepare(
            `UPDATE entities SET relative_path = ?, deleted_at = ?
             WHERE id = ? AND relative_path = ? AND deleted_at IS NULL`,
          )
          .run(
            quarantined.quarantinedRelativePath,
            input.deletedAt,
            artifact.id,
            artifact.relativePath,
          );
      }
      if (current.matchResultIds.length > 0) {
        this.#client
          .prepare(
            `DELETE FROM match_results WHERE id IN (${placeholders(current.matchResultIds.length)})`,
          )
          .run(...current.matchResultIds);
      }
      if (current.profileIds.length > 0) {
        this.#client
          .prepare(
            `DELETE FROM candidate_profiles WHERE id IN (${placeholders(current.profileIds.length)})`,
          )
          .run(...current.profileIds);
      }
      if (current.resumeDraftFileIds.length > 0) {
        this.#client
          .prepare(
            `DELETE FROM files WHERE id IN (${placeholders(current.resumeDraftFileIds.length)})`,
          )
          .run(...current.resumeDraftFileIds);
      }
      this.#client
        .prepare(
          `DELETE FROM files WHERE id IN (${placeholders(current.resumeDocumentIds.length)})`,
        )
        .run(...current.resumeDocumentIds);
      for (const agentRunId of current.agentRunIds) {
        this.#client
          .prepare(
            `DELETE FROM agent_runs
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM profile_versions WHERE agent_run_id = ?)
               AND NOT EXISTS (SELECT 1 FROM job_enrichments WHERE agent_run_id = ?)
               AND NOT EXISTS (SELECT 1 FROM match_advices WHERE agent_run_id = ?)`,
          )
          .run(agentRunId, agentRunId, agentRunId, agentRunId);
        this.#client
          .prepare(
            `DELETE FROM events WHERE stream_type = 'agent_run' AND stream_id = ?
             AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE id = ?)`,
          )
          .run(agentRunId, agentRunId);
      }
      this.#client
        .prepare(
          `INSERT INTO events
           (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
           SELECT ?, 'operation', ?, COALESCE(MAX(sequence_no), 0) + 1, ?, ?, ?
           FROM events WHERE stream_type = 'operation' AND stream_id = ?`,
        )
        .run(
          input.audit.eventKey,
          input.audit.subjectHash,
          input.audit.eventType,
          canonicalJson({ counts: input.audit.counts }),
          input.deletedAt,
          input.audit.subjectHash,
        );
    })();
  }

  public removePurgedArtifact(artifactId: string): void {
    this.#client
      .prepare(
        `DELETE FROM entities
         WHERE id = ? AND deleted_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM file_entity_mappings WHERE entity_id = ?)`,
      )
      .run(artifactId, artifactId);
  }

  public getDeletedArtifact(
    artifactId: string,
  ): ResumeDeletionSnapshot['artifacts'][number] | null {
    const row = this.#client
      .prepare(
        `SELECT id, relative_path FROM entities
         WHERE id = ? AND deleted_at IS NOT NULL`,
      )
      .get(artifactId) as { readonly id: string; readonly relative_path: string } | undefined;
    return row ? { id: row.id, relativePath: row.relative_path } : null;
  }
}
