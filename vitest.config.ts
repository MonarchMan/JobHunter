import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/test/**/*.test.ts',
            'apps/worker/test/**/*.test.ts',
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
          include: ['packages/*/test/**/*.integration.test.ts'],
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
