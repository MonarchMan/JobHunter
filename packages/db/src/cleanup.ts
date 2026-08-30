import type { CleanupCandidate, CleanupFileStore, CleanupRepository } from '@jobhunter/application';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PersistenceError } from './errors.js';

interface CandidateRow {
  readonly id: string;
  readonly relative_path: string | null;
  readonly byte_size: number | null;
  readonly created_at: number;
}

export class SqliteCleanupRepository implements CleanupRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public listCandidates(
    cutoffs: Parameters<CleanupRepository['listCandidates']>[0],
  ): readonly CleanupCandidate[] {
    const observations = this.#client
      .prepare(
        `SELECT json_array(job_id, sync_run_id) AS id, NULL AS relative_path,
                NULL AS byte_size, observed_at AS created_at
         FROM job_observations WHERE observed_at < ?`,
      )
      .all(cutoffs.observationsBefore) as CandidateRow[];
    const sourceDetails = this.#client
      .prepare(
        `SELECT json_array(source_id, external_job_id) AS id, NULL AS relative_path,
                NULL AS byte_size, updated_at AS created_at
         FROM source_job_details WHERE updated_at < ?`,
      )
      .all(cutoffs.sourceDetailsBefore) as CandidateRow[];
    const agentRuns = this.#client
      .prepare(
        `SELECT run.id, NULL AS relative_path, NULL AS byte_size, run.started_at AS created_at
         FROM agent_runs run
         WHERE run.status IN ('failed', 'cancelled') AND run.finished_at < ?
           AND NOT EXISTS (SELECT 1 FROM profile_versions value WHERE value.agent_run_id = run.id)
           AND NOT EXISTS (SELECT 1 FROM job_enrichments value WHERE value.agent_run_id = run.id)
           AND NOT EXISTS (SELECT 1 FROM match_advices value WHERE value.agent_run_id = run.id)
           AND NOT EXISTS (
             SELECT 1 FROM drill_turns value
             WHERE value.question_agent_run_id = run.id OR value.digest_agent_run_id = run.id
           )`,
      )
      .all(cutoffs.agentRunsBefore) as CandidateRow[];
    return [
      ...observations.map((row) => this.#candidate('observation', row)),
      ...sourceDetails.map((row) => this.#candidate('source_detail', row)),
      ...agentRuns.map((row) => this.#candidate('agent_run', row)),
    ];
  }

  public listRegisteredArtifactPaths(): readonly string[] {
    return (
      this.#client.prepare('SELECT relative_path FROM entities WHERE deleted_at IS NULL').all() as {
        readonly relative_path: string;
      }[]
    ).map((row) => row.relative_path);
  }

  public deleteCandidates(candidates: readonly CleanupCandidate[]): void {
    this.#client.transaction(() => {
      for (const candidate of candidates) {
        if (candidate.kind === 'observation') {
          const [jobId, syncRunId] = z
            .tuple([z.string(), z.string()])
            .parse(JSON.parse(candidate.id));
          this.#client
            .prepare('DELETE FROM job_observations WHERE job_id = ? AND sync_run_id = ?')
            .run(jobId, syncRunId);
        } else if (candidate.kind === 'source_detail') {
          const [sourceId, externalJobId] = z
            .tuple([z.string(), z.string()])
            .parse(JSON.parse(candidate.id));
          this.#client
            .prepare('DELETE FROM source_job_details WHERE source_id = ? AND external_job_id = ?')
            .run(sourceId, externalJobId);
        } else if (candidate.kind === 'agent_run') {
          this.#client.prepare('DELETE FROM agent_runs WHERE id = ?').run(candidate.id);
          this.#client
            .prepare("DELETE FROM events WHERE stream_type = 'agent_run' AND stream_id = ?")
            .run(candidate.id);
        }
      }
    })();
  }

  #candidate(kind: CleanupCandidate['kind'], row: CandidateRow): CleanupCandidate {
    return {
      kind,
      id: row.id,
      relativePath: row.relative_path,
      bytes: row.byte_size ?? 0,
      createdAt: row.created_at,
    };
  }
}

export class DataRootCleanupFileStore implements CleanupFileStore {
  readonly #dataRoot: string;
  readonly #artifactRoot: string;

  public constructor(dataRoot: string) {
    this.#dataRoot = path.resolve(dataRoot);
    this.#artifactRoot = path.join(this.#dataRoot, 'artifacts');
  }

  public async listArtifactFiles(): ReturnType<CleanupFileStore['listArtifactFiles']> {
    const files: { relativePath: string; bytes: number; modifiedAt: number }[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) {
          const metadata = await stat(target);
          files.push({
            relativePath: path.relative(this.#dataRoot, target).replaceAll('\\', '/'),
            bytes: metadata.size,
            modifiedAt: metadata.mtimeMs,
          });
        }
      }
    };
    await visit(this.#artifactRoot);
    return files;
  }

  public async remove(relativePaths: readonly string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      const target = this.#resolveArtifact(relativePath);
      await rm(target, { force: true });
    }
  }

  #resolveArtifact(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Cleanup path must be relative.');
    }
    const target = path.resolve(this.#dataRoot, relativePath);
    const relation = path.relative(this.#artifactRoot, target);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new PersistenceError(
        'ARTIFACT_PATH_INVALID',
        'Cleanup path must remain inside the artifact root.',
      );
    }
    return target;
  }
}
