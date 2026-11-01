import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 模块数据结构或契约。 */
export interface TemporaryDataRoot {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** 断言测试目录位于安全的临时路径范围内。 */
export function assertSafeTestDataRoot(candidate: string, workspaceRoot = process.cwd()): void {
  const resolved = path.resolve(candidate);
  const forbidden = path.resolve(workspaceRoot, 'var');
  if (resolved === forbidden || resolved.startsWith(`${forbidden}${path.sep}`)) {
    throw new Error(`Tests must not use the real workspace data root: ${resolved}`);
  }
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export async function createTemporaryDataRoot(
  prefix = 'jobhunter-test-',
): Promise<TemporaryDataRoot> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  assertSafeTestDataRoot(directory);
  let cleaned = false;

  return {
    path: directory,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
