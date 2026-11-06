import Database from 'better-sqlite3';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  realpathSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const serviceOwner = new AsyncLocalStorage<string>();

/** 目录不存在时解析已有父目录，恢复重命名期间仍得到同一锁身份。 */
export function canonicalTaskDataRoot(dataRoot: string): string {
  const absolute = path.resolve(dataRoot);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = path.dirname(absolute);
  return parent === absolute
    ? absolute
    : path.join(canonicalTaskDataRoot(parent), path.basename(absolute));
}

/** IPC 与锁共用用户私有临时目录；锁不能随业务目录恢复一起被重命名。 */
export function taskServiceLockLocation(dataRoot: string): {
  root: string;
  directory: string;
  key: string;
} {
  const root = canonicalTaskDataRoot(dataRoot);
  const directory = path.join(tmpdir(), `jh-task-${String(process.getuid?.() ?? 'local')}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return { root, directory, key: createHash('sha256').update(root).digest('hex').slice(0, 32) };
}

/** 仅在已取得服务锁后的装配范围内授权迁移，普通客户端不能继承这一权限。 */
export function withTaskServiceOwnership<T>(dataRoot: string, work: () => T): T {
  return serviceOwner.run(canonicalTaskDataRoot(dataRoot), work);
}

/** 判断当前装配调用是否持有同一数据目录的服务所有权。 */
export function hasTaskServiceOwnership(dataRoot: string): boolean {
  return serviceOwner.getStore() === canonicalTaskDataRoot(dataRoot);
}

/** 所有者信息仅用于诊断，排他性始终以 SQLite 锁为准。 */
export interface TaskHostOwner {
  readonly kind: 'web' | 'cli';
  readonly pid: number;
  readonly startedAt: string;
}
/** 读取有界、经过校验的诊断侧车，损坏或崩溃遗留文件不能代表活跃所有权。 */
export function readTaskHostOwner(dataRoot: string): TaskHostOwner | null {
  const { directory, key } = taskServiceLockLocation(dataRoot);
  const file = path.join(directory, key + '.owner.json');
  try {
    if (statSync(file).size > 4096) return null;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      !('pid' in value) ||
      !('startedAt' in value)
    )
      return null;
    if (
      (value.kind !== 'web' && value.kind !== 'cli') ||
      typeof value.pid !== 'number' ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.startedAt !== 'string' ||
      value.startedAt.length > 32 ||
      !Number.isFinite(Date.parse(value.startedAt))
    )
      return null;
    return { kind: value.kind, pid: value.pid, startedAt: value.startedAt };
  } catch {
    return null;
  }
}

/** 用专用小数据库的事务锁持有进程级独占权；崩溃后由操作系统释放，不猜测 PID。 */
export function acquireTaskServiceLock(
  dataRoot: string,
  ownerKind?: TaskHostOwner['kind'],
): (() => void) | null {
  const { directory, key } = taskServiceLockLocation(dataRoot);
  const db = new Database(path.join(directory, `${key}.lock.sqlite`), { timeout: 0 });
  try {
    // 1、锁与业务库分离，终身持锁不会阻塞业务数据库的短事务。
    db.exec('BEGIN EXCLUSIVE');
    const ownerFile = path.join(directory, key + '.owner.json');
    if (ownerKind)
      writeFileSync(
        ownerFile,
        JSON.stringify({ kind: ownerKind, pid: process.pid, startedAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
    else rmSync(ownerFile, { force: true });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        if (ownerKind) rmSync(ownerFile, { force: true });
      } finally {
        db.close();
      }
    };
  } catch (error) {
    db.close();
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY') return null;
    throw error;
  }
}
