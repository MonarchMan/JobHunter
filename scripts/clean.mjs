import { lstat, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 清理白名单生成文件；缓存模式保留正式构建及 TypeScript 增量信息。 */
export async function cleanWorkspace(workspaceRoot, { cacheOnly = false } = {}) {
  const root = path.resolve(workspaceRoot);
  const targets = [path.join(root, 'coverage')];

  // 1、收集 workspace 产物；不遍历依赖或业务数据目录。
  for (const workspaceRoot of ['apps', 'packages']) {
    const absoluteWorkspaceRoot = path.join(root, workspaceRoot);
    await validateTarget(root, absoluteWorkspaceRoot);
    let entries = [];
    try {
      entries = await readdir(absoluteWorkspaceRoot, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(absoluteWorkspaceRoot, entry.name);
      for (const name of ['coverage', 'test-results', 'playwright-report'])
        targets.push(path.join(directory, name));
      if (!cacheOnly) {
        targets.push(path.join(directory, 'dist'));
        targets.push(path.join(directory, 'tsconfig.tsbuildinfo'));
      }
    }
  }

  // 2、测试目录整体清理，日常构建目录在缓存模式下只移除缓存。
  targets.push(path.join(root, 'test-results'), path.join(root, 'playwright-report'));
  const web = path.join(root, 'apps', 'web');
  await validateTarget(root, web);
  let webEntries = [];
  try {
    webEntries = await readdir(web, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of webEntries) {
    if (/^\.next-browser-fixture(?:-[a-zA-Z0-9-]+)?$/.test(entry.name))
      targets.push(path.join(web, entry.name));
  }
  targets.push(
    ...(cacheOnly
      ? [path.join(web, '.next', 'cache'), path.join(web, '.next', 'dev', 'cache')]
      : [path.join(web, '.next')]),
  );
  // 3、先验证全部绝对路径及链接边界，再删除可重建产物。
  for (const target of targets) await validateTarget(root, target);
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

/** 拒绝越界目标以及经过符号链接或 junction 的路径。 */
async function validateTarget(root, target) {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to clean path outside the workspace: ${target}`);
  }
  // 1、逐级检查，避免通过中间目录链接删除仓库外的文件。
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Refusing to clean linked path: ${current}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--cache-only')) throw new Error('Unknown clean option');
  await cleanWorkspace(path.resolve(import.meta.dirname, '..'), {
    cacheOnly: args.includes('--cache-only'),
  });
}
