import type { ResumeArtifactReader } from '@jobhunter/application';
import type Database from 'better-sqlite3';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { PersistenceError } from './errors.js';

interface ArtifactRow {
  readonly relative_path: string;
  readonly byte_size: number;
}

export class SqliteResumeArtifactReader implements ResumeArtifactReader {
  readonly #client: Database.Database;
  readonly #dataRoot: string;

  public constructor(client: Database.Database, dataRoot: string) {
    this.#client = client;
    this.#dataRoot = path.resolve(dataRoot);
  }

  public async read(
    artifactId: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    if (signal.aborted) throw new DOMException('Resume artifact read was aborted.', 'AbortError');
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('Maximum resume byte size must be a positive safe integer.');
    }
    const row = this.#client
      .prepare(
        `SELECT relative_path, byte_size FROM file_artifacts
         WHERE id = ? AND kind = 'resume' AND deleted_at IS NULL`,
      )
      .get(artifactId) as ArtifactRow | undefined;
    if (!row) throw new TypeError('Resume artifact was not found.');
    if (row.byte_size < 1 || row.byte_size > maximumBytes) {
      throw new TypeError('Resume artifact size is invalid.');
    }
    const target = path.resolve(this.#dataRoot, row.relative_path);
    const relation = path.relative(this.#dataRoot, target);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Artifact path escapes the data root.');
    }
    const file = await open(target, 'r');
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size !== row.byte_size) {
        throw new TypeError('Resume artifact does not match its stored metadata.');
      }
      const bytes = new Uint8Array(await file.readFile({ signal }));
      return bytes;
    } finally {
      await file.close();
    }
  }
}
