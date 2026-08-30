import { createHash, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  hasActiveDatabaseConnection,
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from './connection.js';
import { PersistenceError } from './errors.js';

const manifestSchema = z
  .object({
    formatVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    database: z.object({ fileName: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    artifacts: z.array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        byteSize: z.number().int().nonnegative(),
      }),
    ),
  })
  .strict();

export type BackupManifest = z.infer<typeof manifestSchema>;

interface ArtifactReferenceRow {
  readonly id: string;
  readonly relative_path: string;
  readonly sha256: string;
  readonly byte_size: number;
}

async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let readResult = await handle.read(buffer, 0, buffer.byteLength, null);
    while (readResult.bytesRead > 0) {
      hash.update(buffer.subarray(0, readResult.bytesRead));
      readResult = await handle.read(buffer, 0, buffer.byteLength, null);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function resolveContained(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Backup artifact path must be relative.');
  }
  const target = path.resolve(root, relativePath);
  const relation = path.relative(root, target);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Backup artifact path escapes its root.');
  }
  return target;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function createBackup(
  source: SqliteDatabaseHandle,
  destinationDirectory: string,
): Promise<BackupManifest> {
  const destination = path.resolve(destinationDirectory);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  if (await pathExists(destination))
    throw new Error(`Backup destination already exists: ${destination}`);
  const temporary = path.join(parent, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  await mkdir(temporary);

  try {
    const snapshotFileName = 'jobhunter.sqlite';
    const snapshotPath = path.join(temporary, snapshotFileName);
    await source.client.backup(snapshotPath);
    const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    let artifacts: ArtifactReferenceRow[];
    try {
      artifacts = snapshot
        .prepare(
          `SELECT id, relative_path, sha256, byte_size
           FROM entities WHERE deleted_at IS NULL ORDER BY id`,
        )
        .all() as ArtifactReferenceRow[];
    } finally {
      snapshot.close();
    }

    const manifestArtifacts: BackupManifest['artifacts'] = [];
    for (const artifact of artifacts) {
      const sourcePath = resolveContained(source.dataRoot, artifact.relative_path);
      const sourceHash = await fileHash(sourcePath);
      const sourceStat = await stat(sourcePath);
      if (sourceHash !== artifact.sha256 || sourceStat.size !== artifact.byte_size) {
        throw new PersistenceError(
          'DATABASE_INTEGRITY_ERROR',
          `Artifact does not match its database record: ${artifact.id}`,
        );
      }
      const backupPath = resolveContained(path.join(temporary, 'files'), artifact.relative_path);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(sourcePath, backupPath);
      if ((await fileHash(backupPath)) !== artifact.sha256) {
        throw new PersistenceError(
          'DATABASE_INTEGRITY_ERROR',
          `Copied artifact hash mismatch: ${artifact.id}`,
        );
      }
      manifestArtifacts.push({
        id: artifact.id,
        relativePath: artifact.relative_path,
        sha256: artifact.sha256,
        byteSize: artifact.byte_size,
      });
    }

    const manifest: BackupManifest = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      database: { fileName: snapshotFileName, sha256: await fileHash(snapshotPath) },
      artifacts: manifestArtifacts,
    };
    await writeFile(
      path.join(temporary, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        flag: 'wx',
      },
    );
    await rename(temporary, destination);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function readAndVerifyBackup(backupRoot: string): Promise<BackupManifest> {
  const manifestValue: unknown = JSON.parse(
    await readFile(path.join(backupRoot, 'manifest.json'), 'utf8'),
  );
  const manifest = manifestSchema.parse(manifestValue);
  const databasePath = resolveContained(backupRoot, manifest.database.fileName);
  if ((await fileHash(databasePath)) !== manifest.database.sha256) {
    throw new PersistenceError(
      'DATABASE_INTEGRITY_ERROR',
      'Backup database hash does not match manifest.',
    );
  }
  for (const artifact of manifest.artifacts) {
    const artifactPath = resolveContained(path.join(backupRoot, 'files'), artifact.relativePath);
    const artifactStat = await stat(artifactPath);
    if (
      artifactStat.size !== artifact.byteSize ||
      (await fileHash(artifactPath)) !== artifact.sha256
    ) {
      throw new PersistenceError(
        'DATABASE_INTEGRITY_ERROR',
        `Backup artifact does not match manifest: ${artifact.id}`,
      );
    }
  }
  return manifest;
}

export async function verifyBackup(backupDirectory: string): Promise<BackupManifest> {
  return readAndVerifyBackup(path.resolve(backupDirectory));
}

export interface BackupListItem {
  readonly directory: string;
  readonly createdAt: string | null;
  readonly artifactCount: number | null;
  readonly totalArtifactBytes: number | null;
  readonly manifestValid: boolean;
}

export async function listBackups(backupRoot: string): Promise<readonly BackupListItem[]> {
  const root = path.resolve(backupRoot);
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const items: BackupListItem[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const directory = path.join(root, entry.name);
    if (!(await pathExists(path.join(directory, 'manifest.json')))) continue;
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(directory, 'manifest.json'), 'utf8'),
      );
      const manifest = manifestSchema.parse(value);
      items.push({
        directory,
        createdAt: manifest.createdAt,
        artifactCount: manifest.artifacts.length,
        totalArtifactBytes: manifest.artifacts.reduce(
          (total, artifact) => total + artifact.byteSize,
          0,
        ),
        manifestValid: true,
      });
    } catch {
      items.push({
        directory,
        createdAt: null,
        artifactCount: null,
        totalArtifactBytes: null,
        manifestValid: false,
      });
    }
  }
  return items.toSorted(
    (left, right) =>
      (right.createdAt ?? '').localeCompare(left.createdAt ?? '') ||
      left.directory.localeCompare(right.directory),
  );
}

function assertSafeRestoreTarget(target: string, backupRoot: string): void {
  const root = path.parse(target).root;
  const protectedRoots = [root, path.resolve(process.cwd()), path.resolve(homedir())];
  if (protectedRoots.includes(target) || path.dirname(target) === target) {
    throw new PersistenceError('DATABASE_OPEN_FAILED', 'Restore target is too broad.');
  }
  const backupRelation = path.relative(target, backupRoot);
  if (!backupRelation || (!backupRelation.startsWith('..') && !path.isAbsolute(backupRelation))) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Backup directory must not be inside the restore target.',
    );
  }
}

function assertExternalExclusiveAccess(databasePath: string): void {
  if (!requireFileExists(databasePath)) return;
  const probe = new Database(databasePath, { fileMustExist: true });
  try {
    probe.pragma('busy_timeout = 100');
    probe.pragma('locking_mode = EXCLUSIVE');
    probe.exec('BEGIN EXCLUSIVE');
    probe.exec('ROLLBACK');
  } catch (error) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Restore requires Worker, Web, and other database clients to be stopped.',
      error,
    );
  } finally {
    probe.close();
  }
}

function requireFileExists(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

export interface RestoreResult {
  readonly restoredDataRoot: string;
  readonly previousDataRoot: string | null;
}

export interface RestoreOperationPlan {
  readonly kind: 'restore';
  readonly backupDirectory: string;
  readonly targetDataRoot: string;
  readonly targets: readonly string[];
  readonly counts: { readonly databaseFiles: 1; readonly artifacts: number };
  readonly bytes: number;
  readonly warnings: readonly string[];
  readonly expiresAt: number;
  readonly confirmationToken: string;
}

async function directoryFingerprint(target: string): Promise<string> {
  if (!(await pathExists(target))) return 'absent';
  const entries: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).toSorted(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(target, absolute);
      if (entry.isSymbolicLink()) {
        entries.push(`${relativePath}|symlink`);
      } else if (entry.isDirectory()) {
        entries.push(`${relativePath}|directory`);
        await visit(absolute);
      } else {
        const metadata = await stat(absolute);
        entries.push(
          `${relativePath}|file|${String(metadata.size)}|${String(Math.trunc(metadata.mtimeMs))}`,
        );
      }
    }
  };
  await visit(target);
  return createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex');
}

function restoreToken(input: {
  readonly backupRoot: string;
  readonly target: string;
  readonly manifest: BackupManifest;
  readonly targetFingerprint: string;
  readonly expiresAt: number;
}): string {
  const material = JSON.stringify({
    backupRoot: input.backupRoot,
    target: input.target,
    databaseHash: input.manifest.database.sha256,
    artifactHashes: input.manifest.artifacts.map((artifact) => artifact.sha256),
    targetFingerprint: input.targetFingerprint,
    expiresAt: input.expiresAt,
  });
  return `${String(input.expiresAt)}.${createHash('sha256').update(material, 'utf8').digest('hex')}`;
}

export async function planRestoreBackup(
  backupDirectory: string,
  targetDataRoot: string,
  options: { readonly now?: number; readonly tokenLifetimeMs?: number } = {},
): Promise<RestoreOperationPlan> {
  const backupRoot = path.resolve(backupDirectory);
  const target = path.resolve(targetDataRoot);
  assertSafeRestoreTarget(target, backupRoot);
  const manifest = await readAndVerifyBackup(backupRoot);
  const databasePath = path.join(target, manifest.database.fileName);
  if (hasActiveDatabaseConnection(databasePath)) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Restore requires all in-process database handles to be closed.',
    );
  }
  assertExternalExclusiveAccess(databasePath);
  const lifetime = options.tokenLifetimeMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 30 * 60_000) {
    throw new TypeError('Restore confirmation lifetime is invalid.');
  }
  const expiresAt = (options.now ?? Date.now()) + lifetime;
  const targetFingerprint = await directoryFingerprint(target);
  const confirmationToken = restoreToken({
    backupRoot,
    target,
    manifest,
    targetFingerprint,
    expiresAt,
  });
  const databaseBytes = (await stat(path.join(backupRoot, manifest.database.fileName))).size;
  return {
    kind: 'restore',
    backupDirectory: backupRoot,
    targetDataRoot: target,
    targets: [target],
    counts: { databaseFiles: 1, artifacts: manifest.artifacts.length },
    bytes:
      databaseBytes + manifest.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
    warnings: (await pathExists(target))
      ? ['现有数据目录将被重命名保留，应用、Worker 和 Web 必须停止。']
      : ['应用、Worker 和 Web 必须保持停止直到恢复完成。'],
    expiresAt,
    confirmationToken,
  };
}

export async function restoreBackup(
  backupDirectory: string,
  targetDataRoot: string,
  confirmationToken: string,
  options: { readonly now?: number } = {},
): Promise<RestoreResult> {
  const backupRoot = path.resolve(backupDirectory);
  const target = path.resolve(targetDataRoot);
  assertSafeRestoreTarget(target, backupRoot);
  const manifest = await readAndVerifyBackup(backupRoot);
  const separator = confirmationToken.indexOf('.');
  const expiresAt = Number(confirmationToken.slice(0, separator));
  if (
    separator < 1 ||
    !Number.isSafeInteger(expiresAt) ||
    (options.now ?? Date.now()) > expiresAt
  ) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Restore confirmation token is invalid or expired.',
    );
  }
  const expectedToken = restoreToken({
    backupRoot,
    target,
    manifest,
    targetFingerprint: await directoryFingerprint(target),
    expiresAt,
  });
  if (confirmationToken !== expectedToken) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Restore target or backup changed after the dry-run plan.',
    );
  }
  const databasePath = path.join(target, manifest.database.fileName);
  if (hasActiveDatabaseConnection(databasePath)) {
    throw new PersistenceError(
      'DATABASE_OPEN_FAILED',
      'Restore requires all in-process database handles to be closed.',
    );
  }

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const lockPath = path.join(parent, `.${path.basename(target)}.restore.lock`);
  const lock = await open(lockPath, 'wx');
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.restore`);
  let previous: string | null = null;

  try {
    assertExternalExclusiveAccess(databasePath);
    await mkdir(temporary);
    await copyFile(
      resolveContained(backupRoot, manifest.database.fileName),
      path.join(temporary, manifest.database.fileName),
    );
    for (const artifact of manifest.artifacts) {
      const source = resolveContained(path.join(backupRoot, 'files'), artifact.relativePath);
      const destination = resolveContained(temporary, artifact.relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      if ((await fileHash(destination)) !== artifact.sha256) {
        throw new PersistenceError(
          'DATABASE_INTEGRITY_ERROR',
          `Restored artifact hash mismatch: ${artifact.id}`,
        );
      }
    }

    const verification = openSqliteDatabase({
      dataRoot: temporary,
      databaseFileName: manifest.database.fileName,
      runMigrations: false,
    });
    verification.close();

    if (await pathExists(target)) {
      previous = `${target}.pre-restore-${Date.now().toString()}`;
      await rename(target, previous);
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      if (previous && !(await pathExists(target))) await rename(previous, target);
      throw error;
    }
    return { restoredDataRoot: target, previousDataRoot: previous };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
