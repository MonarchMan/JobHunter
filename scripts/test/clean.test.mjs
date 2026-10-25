import { mkdtemp, mkdir, writeFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cleanWorkspace } from '../clean.mjs';

/** 在独立临时仓库验证清理范围，避免触及开发数据。 */
test('缓存清理保留编译产物，完整清理保留源码、依赖和数据且可重复执行', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-clean-'));
  const preserved = ['var/jobs.sqlite', 'node_modules/example/index.js', 'apps/web/src/index.ts'];
  const compiled = [
    'apps/web/.next/BUILD_ID',
    'apps/web/.next/server/index.js',
    'packages/domain/dist/index.js',
    'packages/domain/tsconfig.tsbuildinfo',
  ];
  const caches = [
    'apps/web/.next/cache/a',
    'apps/web/.next/dev/cache/a',
    'apps/web/.next-browser-fixture/a',
    'apps/web/.next-browser-fixture-test-1/a',
    'apps/web/test-results/a',
    'coverage/a',
  ];
  try {
    // 1、构造数据与编译产物共存的工作区。
    for (const name of [...preserved, ...compiled, ...caches]) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'fixture');
    }
    // 2、缓存模式必须保留可运行产物；完整模式必须保留用户数据。
    await cleanWorkspace(root, { cacheOnly: true });
    for (const name of [...preserved, ...compiled]) await access(path.join(root, name));
    for (const name of caches)
      await assert.rejects(access(path.join(root, name)), { code: 'ENOENT' });
    await cleanWorkspace(root);
    await cleanWorkspace(root);
    for (const name of preserved) await access(path.join(root, name));
    for (const name of compiled)
      await assert.rejects(access(path.join(root, name)), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** 验证缓存路径中的 junction 不会让删除越过工作区边界。 */
test('拒绝通过目录链接清理外部文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-clean-link-'));
  const external = await mkdtemp(path.join(tmpdir(), 'jobhunter-clean-external-'));
  try {
    // 1、让 Next.js 构建目录指向外部目录。
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await mkdir(path.join(external, 'cache'));
    await writeFile(path.join(external, 'cache/keep'), 'keep');
    await symlink(external, path.join(root, 'apps/web/.next'), 'junction');
    // 2、两种清理模式都应拒绝链接，并保留外部文件。
    await assert.rejects(cleanWorkspace(root, { cacheOnly: true }), /linked path/);
    await assert.rejects(cleanWorkspace(root), /linked path/);
    await access(path.join(external, 'cache/keep'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
