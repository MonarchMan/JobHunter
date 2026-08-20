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
      .prepare('SELECT id FROM resume_documents WHERE id = ?')
      .get(resumeDocumentId);
    if (!document) return null;

    const profiles = new Set<string>(
      selectStrings(
        this.#client,
        'SELECT DISTINCT profile_id AS id FROM profile_versions WHERE resume_document_id = ?',
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
        `SELECT DISTINCT resume_document_id AS id FROM profile_versions
         WHERE profile_id IN (${placeholders(profileIds.length)})
           AND resume_document_id IS NOT NULL`,
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
    const artifactRows = this.#client
      .prepare(
        `SELECT fa.id, fa.relative_path
         FROM file_artifacts fa
         JOIN resume_documents rd ON rd.artifact_id = fa.id
         WHERE rd.id IN (${placeholders(sortedDocumentIds.length)})
         ORDER BY fa.id`,
      )
      .all(...sortedDocumentIds) as { readonly id: string; readonly relative_path: string }[];

    return {
      requestedResumeDocumentId: resumeDocumentId,
      profileIds,
      profileVersionIds,
      resumeDocumentIds: sortedDocumentIds,
      matchResultIds,
      agentRunIds: sortedStrings(agentRuns),
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
            `UPDATE file_artifacts SET relative_path = ?, deleted_at = ?
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
      this.#client
        .prepare(
          `DELETE FROM resume_documents WHERE id IN (${placeholders(current.resumeDocumentIds.length)})`,
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
      }
      this.#client
        .prepare(
          `INSERT INTO operation_audit_events
           (event_key, event_type, subject_hash, details_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.audit.eventKey,
          input.audit.eventType,
          input.audit.subjectHash,
          canonicalJson({ counts: input.audit.counts }),
          input.deletedAt,
        );
    })();
  }

  public removePurgedArtifact(artifactId: string): void {
    this.#client
      .prepare(
        `DELETE FROM file_artifacts
         WHERE id = ? AND deleted_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM resume_documents WHERE artifact_id = ?)`,
      )
      .run(artifactId, artifactId);
  }

  public getDeletedArtifact(
    artifactId: string,
  ): ResumeDeletionSnapshot['artifacts'][number] | null {
    const row = this.#client
      .prepare(
        `SELECT id, relative_path FROM file_artifacts
         WHERE id = ? AND deleted_at IS NOT NULL`,
      )
      .get(artifactId) as { readonly id: string; readonly relative_path: string } | undefined;
    return row ? { id: row.id, relativePath: row.relative_path } : null;
  }
}
