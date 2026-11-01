import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export async function loadFixture(fixturesRoot: string, relativePath: string): Promise<Buffer> {
  const root = path.resolve(fixturesRoot);
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Fixture path escapes the fixture root: ${relativePath}`);
  }
  return readFile(target);
}
