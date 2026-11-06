import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageManifests = [
  'apps/cli/package.json',
  'packages/matching/package.json',
  'packages/common/package.json',
  'packages/recruitment/package.json',
  'packages/user/package.json',
];

/** 读取仓库内 JSON 文件，供开发导出契约测试复用。 */
function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

/** 在指定应用目录按 Node 条件解析内部包，但不实际加载模块。 */
function resolvePackages(cwd, conditions, specifiers) {
  const script = `console.log(JSON.stringify(${JSON.stringify(
    specifiers,
  )}.map((specifier) => [specifier, import.meta.resolve(specifier)])))`;
  const result = spawnSync(
    process.execPath,
    [
      ...conditions.flatMap((condition) => ['--conditions', condition]),
      '--input-type=module',
      '-e',
      script,
    ],
    { cwd: path.join(repositoryRoot, cwd), encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('workspace development exports', () => {
  it('keeps exactly four shared modules and removes legacy workspace dependencies', () => {
    const names = readdirSync(path.join(repositoryRoot, 'packages')).sort();
    expect(names).toEqual(['common', 'matching', 'recruitment', 'user']);
    expect(readdirSync(path.join(repositoryRoot, 'apps')).sort()).toEqual(['cli', 'web']);
    for (const manifestPath of [...packageManifests, 'apps/web/package.json']) {
      const manifest = readJson(manifestPath);
      expect(manifest.dependencies?.['@jobhunter/application']).toBeUndefined();
      expect(manifest.dependencies?.['@jobhunter/db']).toBeUndefined();
    }
  });
  it('places source conditions before built runtime exports', () => {
    for (const manifestPath of packageManifests) {
      const manifest = readJson(manifestPath);
      for (const target of Object.values(manifest.exports)) {
        expect(Object.keys(target)[0], manifestPath).toBe('development');
        expect(target.development, manifestPath).toMatch(/^\.\/src\/.*\.ts$/u);
        expect(target.import, manifestPath).toMatch(/^\.\/dist\/.*\.js$/u);
      }
    }
  });

  it('resolves Web and Worker dependencies from source only under development', () => {
    const webSpecifiers = [
      '@jobhunter/common/config/config',
      '@jobhunter/common/web-contracts',
      '@jobhunter/user/profile',
      '@jobhunter/common/persistence/connection',
      '@jobhunter/common/persistence/maintenance',
      '@jobhunter/common/domain',
      '@jobhunter/common/models',
      '@jobhunter/recruitment/mail-config',
      '@jobhunter/recruitment/mail-metadata',
      '@jobhunter/matching',
      '@jobhunter/user/templates',
      '@jobhunter/recruitment/catalog-data',
    ];
    const applicationSpecifiers = [
      '@jobhunter/user/media',
      '@jobhunter/user/ocr-contracts',
      '@jobhunter/user/parsers',
      '@jobhunter/user/polish',
    ];
    const workerSpecifiers = [
      '@jobhunter/common/agent',
      '@jobhunter/common/tasks',
      '@jobhunter/common/persistence/connection',
      '@jobhunter/common/logging',
      '@jobhunter/recruitment/platform-connectors',
      '@jobhunter/recruitment/source-contracts',
      '@jobhunter/recruitment',
    ];

    for (const [specifier, resolved] of [
      ...resolvePackages('apps/web', ['development'], webSpecifiers),
      ...resolvePackages('apps/web', ['development'], applicationSpecifiers),
      ...resolvePackages('apps/web', ['development'], workerSpecifiers),
    ]) {
      expect(resolved, specifier).toMatch(/[\\/]src[\\/].*\.ts$/u);
    }
    for (const [specifier, resolved] of resolvePackages('apps/web', [], webSpecifiers)) {
      expect(resolved, specifier).toMatch(/[\\/]dist[\\/].*\.js$/u);
    }
    for (const [specifier, resolved] of resolvePackages('apps/web', [], applicationSpecifiers)) {
      expect(resolved, specifier).toMatch(/[\\/]dist[\\/].*\.js$/u);
    }
  });

  it('keeps development startup independent from build and exposes watch typechecking', () => {
    const root = readJson('package.json');
    const web = readJson('apps/web/package.json');
    expect(web.scripts.predev).toBeUndefined();
    expect(web.scripts.dev).toBe('node --conditions=development --import tsx src/server/main.ts');
    expect(web.scripts['dev:typecheck']).toBe('pnpm --workspace-root typecheck:watch');
    expect(root.scripts['typecheck:watch']).toContain('tsc -b --watch');
  });

  it('loads the complete Web and Worker module graphs while rejecting workspace dist', () => {
    const rootUrl = pathToFileURL(`${repositoryRoot}${path.sep}`).href;
    const webUrl = pathToFileURL(
      path.join(repositoryRoot, 'apps/web/src/server/container.ts'),
    ).href;
    const workerUrl = pathToFileURL(
      path.join(repositoryRoot, 'apps/web/src/server/task-runtime.ts'),
    ).href;
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({
        resolve(specifier, context, nextResolve) {
          const resolved = nextResolve(specifier, context);
          if (resolved.url.startsWith(${JSON.stringify(rootUrl)}) &&
              /\\/(?:apps\\/[^/]+|packages\\/(?:mail\\/)?[^/]+)\\/dist\\//u.test(resolved.url)) {
            throw new Error('Development loaded a workspace build artifact: ' + resolved.url);
          }
          return resolved;
        }
      });
      await import(${JSON.stringify(webUrl)});
      await import(${JSON.stringify(workerUrl)});
    `;
    const result = spawnSync(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: 90_000 },
    );
    expect(result.status, result.stderr).toBe(0);
  }, 180_000);

  it('keeps lightweight responsibility entries isolated from heavy runtime implementations', () => {
    // 1、从实际公开 exports 收集全部契约，避免新增入口绕过重运行时隔离验收。
    const contracts = new Set(['@jobhunter/common/domain']);
    for (const owner of ['common', 'recruitment', 'user', 'matching']) {
      const manifest = readJson(`packages/${owner}/package.json`);
      for (const [key, entry] of Object.entries(manifest.exports)) {
        if (!key.includes('contracts') && !entry.development.includes('/contracts/')) continue;
        if (key.includes('*')) {
          const directory = path.dirname(entry.development);
          for (const file of readdirSync(path.join(repositoryRoot, 'packages', owner, directory))) {
            if (file.endsWith('.ts'))
              contracts.add(`@jobhunter/${owner}${key.slice(1).replace('*', file.slice(0, -3))}`);
          }
        } else contracts.add(`@jobhunter/${owner}${key.slice(1)}`);
      }
    }
    const cases = [
      ...[...contracts].sort().map((specifier) => ({
        cwd: 'apps/web',
        specifier,
        forbidden: [
          '/packages/common/src/agent/runner.ts',
          '/packages/common/src/models/',
          '/packages/user/src/resume/parsers/',
          '/packages/user/src/resume/ocr/index.ts',
          '/packages/recruitment/src/platform/connectors/',
          '/packages/recruitment/src/mail/connectors/',
          '/node_modules/better-sqlite3/',
          '/node_modules/playwright/',
          '/node_modules/pdfjs-dist/',
          '/node_modules/tesseract.js/',
        ],
      })),
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/recruitment/catalog-data',
        forbidden: [
          '/packages/recruitment/src/sources/catalog/registry.ts',
          '/packages/recruitment/src/sources/companies/',
        ],
      },
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/recruitment/mail-metadata',
        forbidden: [
          '/packages/recruitment/src/mail/connectors/gmail.ts',
          '/packages/recruitment/src/mail/connectors/graph.ts',
          '/packages/recruitment/src/mail/connectors/imap.ts',
          '/node_modules/imapflow/',
          '/node_modules/mailparser/',
        ],
      },
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/user/media',
        forbidden: [
          '/packages/user/src/resume/parsers/',
          '/packages/user/src/resume/ocr/',
          '/node_modules/pdfjs-dist/',
          '/node_modules/tesseract.js/',
          '/node_modules/mammoth/',
        ],
      },
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/user/ocr-contracts',
        forbidden: [
          '/packages/user/src/resume/ocr/index.ts',
          '/node_modules/tesseract.js/',
          '/node_modules/@tesseract.js-data/',
        ],
      },
    ];
    for (const item of cases) {
      const script = `
        import { registerHooks } from 'node:module';
        const forbidden = ${JSON.stringify(item.forbidden)};
        registerHooks({
          resolve(specifier, context, nextResolve) {
            const resolved = nextResolve(specifier, context);
            const normalized = resolved.url.replaceAll('\\\\', '/');
            const match = forbidden.find((part) => normalized.includes(part));
            if (match) throw new Error(${JSON.stringify(item.specifier)} + ' loaded ' + match);
            return resolved;
          }
        });
        await import(${JSON.stringify(item.specifier)});
      `;
      const result = spawnSync(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '--input-type=module', '-e', script],
        { cwd: path.join(repositoryRoot, item.cwd), encoding: 'utf8', timeout: 90_000 },
      );
      expect(result.status, `${item.specifier}: ${result.stderr}`).toBe(0);
    }
  }, 180_000);
});
