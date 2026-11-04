import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 多个测试文件会各自 fork 真实 Chromium 或 tsx 子进程；按 CPU 数放开文件级并行会
    // 严重超额订阅，导致子进程被 CPU 饥饿拖过固定超时。限制并发文件数，保留吞吐的同时
    // 让重子进程用例稳定通过。
    maxWorkers: '50%',
    // 重用例（全仓 AST 扫描、真实 Chromium 启动、批量子进程解析）在并行负载下会被 CPU
    // 饥饿拖慢；把默认单例超时从 5 秒提高到 30 秒，避免负载抖动误杀，同时保留挂起检测。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/test/**/*.test.ts',
            'apps/*/test/**/*.test.ts',
            'scripts/test/**/*.test.mjs',
          ],
          exclude: ['**/*.integration.test.ts', '**/*.e2e.test.ts', '**/*.online.test.ts'],
          sequence: { shuffle: false },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [
            'packages/*/test/**/*.integration.test.ts',
            'apps/*/test/**/*.integration.test.ts',
          ],
          sequence: { shuffle: false },
        },
      },
      {
        extends: true,
        test: { name: 'e2e', include: ['apps/*/test/**/*.e2e.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'online',
          include: ['packages/*/test/**/*.online.test.ts', 'apps/*/test/**/*.online.test.ts'],
        },
      },
    ],
  },
});
