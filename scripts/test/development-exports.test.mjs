import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageManifests = [
  'apps/cli/package.json',
  'apps/worker/package.json',
  'packages/agent-core/package.json',
  'packages/application/package.json',
  'packages/db/package.json',
  'packages/domain/package.json',
  'packages/llm/package.json',
  'packages/mail/connectors/package.json',
  'packages/mail/core/package.json',
  'packages/matching/package.json',
  'packages/observability/package.json',
  'packages/platform-connectors/package.json',
  'packages/platform-core/package.json',
  'packages/resume/package.json',
  'packages/resume-template/package.json',
  'packages/source-core/package.json',
  'packages/sources/package.json',
  'packages/testkit/package.json',
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
      '@jobhunter/application/config',
      '@jobhunter/application/contracts',
      '@jobhunter/application/profile',
      '@jobhunter/db/core',
      '@jobhunter/db/maintenance',
      '@jobhunter/domain',
      '@jobhunter/llm',
      '@jobhunter/mail-connectors/config',
      '@jobhunter/mail-connectors/metadata',
      '@jobhunter/matching',
      '@jobhunter/resume-template',
      '@jobhunter/sources/catalog-data',
    ];
    const applicationSpecifiers = [
      '@jobhunter/resume/media',
      '@jobhunter/resume/ocr-contracts',
      '@jobhunter/resume/parsers',
      '@jobhunter/resume/polish',
    ];
    const workerSpecifiers = [
      '@jobhunter/agent-core',
      '@jobhunter/application',
      '@jobhunter/db',
      '@jobhunter/observability',
      '@jobhunter/platform-connectors',
      '@jobhunter/source-core',
      '@jobhunter/sources',
    ];

    for (const [specifier, resolved] of [
      ...resolvePackages('apps/web', ['development'], webSpecifiers),
      ...resolvePackages('packages/application', ['development'], applicationSpecifiers),
      ...resolvePackages('apps/worker', ['development'], workerSpecifiers),
    ]) {
      expect(resolved, specifier).toMatch(/[\\/]src[\\/].*\.ts$/u);
    }
    for (const [specifier, resolved] of resolvePackages('apps/web', [], webSpecifiers)) {
      expect(resolved, specifier).toMatch(/[\\/]dist[\\/].*\.js$/u);
    }
    for (const [specifier, resolved] of resolvePackages(
      'packages/application',
      [],
      applicationSpecifiers,
    )) {
      expect(resolved, specifier).toMatch(/[\\/]dist[\\/].*\.js$/u);
    }
  });

  it('keeps development startup independent from build and exposes watch typechecking', () => {
    const root = readJson('package.json');
    const web = readJson('apps/web/package.json');
    expect(web.scripts.predev).toBeUndefined();
    expect(web.scripts.dev).toBe('tsx src/server/main.ts');
    expect(web.scripts['dev:typecheck']).toBe('pnpm --workspace-root typecheck:watch');
    expect(root.scripts['typecheck:watch']).toContain('tsc -b --watch');
  });

  it('loads the complete Web and Worker module graphs while rejecting workspace dist', () => {
    const rootUrl = pathToFileURL(`${repositoryRoot}${path.sep}`).href;
    const webUrl = pathToFileURL(
      path.join(repositoryRoot, 'apps/web/src/server/container.ts'),
    ).href;
    const workerUrl = pathToFileURL(path.join(repositoryRoot, 'apps/worker/src/index.ts')).href;
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
      { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.status, result.stderr).toBe(0);
  }, 35_000);

  it('keeps lightweight responsibility entries isolated from heavy runtime implementations', () => {
    const cases = [
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/sources/catalog-data',
        forbidden: [
          '/packages/sources/src/catalog/registry.ts',
          '/packages/sources/src/companies/',
        ],
      },
      {
        cwd: 'apps/web',
        specifier: '@jobhunter/mail-connectors/metadata',
        forbidden: [
          '/packages/mail/connectors/src/gmail.ts',
          '/packages/mail/connectors/src/graph.ts',
          '/packages/mail/connectors/src/imap.ts',
          '/node_modules/imapflow/',
          '/node_modules/mailparser/',
        ],
      },
      {
        cwd: 'packages/application',
        specifier: '@jobhunter/resume/media',
        forbidden: [
          '/packages/resume/src/parsers/',
          '/packages/resume/src/ocr/',
          '/node_modules/pdfjs-dist/',
          '/node_modules/tesseract.js/',
          '/node_modules/mammoth/',
        ],
      },
      {
        cwd: 'packages/application',
        specifier: '@jobhunter/resume/ocr-contracts',
        forbidden: [
          '/packages/resume/src/ocr/index.ts',
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
        { cwd: path.join(repositoryRoot, item.cwd), encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.status, `${item.specifier}: ${result.stderr}`).toBe(0);
    }
  }, 35_000);
});
