const packageNames = ['matching', 'common', 'user', 'recruitment'];

const privatePackageImportRules = packageNames.map((packageName) => ({
  name: `no-private-imports-from-${packageName}`,
  comment: 'Cross-package imports must use package public exports.',
  severity: 'error',
  from: { path: `^packages/${packageName}/` },
  to: {
    path: `^packages/(?!${packageName}/)[^/]+/src/(?!index\\.(?:ts|tsx)$)`,
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...privatePackageImportRules,
    {
      name: 'no-packages-import-apps',
      comment: 'Reusable packages must never depend on process entry points.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'domain-is-pure',
      comment:
        'The domain package owns pure domain concepts and must not depend on other packages.',
      severity: 'error',
      from: { path: '^packages/common/(src|test)/domain/' },
      to: { path: '^packages/(?!common/)' },
    },
    {
      name: 'use-cases-do-not-import-persistence',
      comment: 'Module use cases declare ports; persistence is wired by process entries.',
      severity: 'error',
      from: {
        path: '^packages/(?:recruitment/src/(?:sync|jobs|settings|diagnostics|platform/application|mail/application)|user/src/(?:profile|interview)|matching/src/application)/',
      },
      to: { path: '^packages/[^/]+/src/persistence/' },
    },
    {
      name: 'business-domains-do-not-import-runtime',
      comment: 'Pure business rules must not load adapters, model runtimes or SDKs.',
      severity: 'error',
      from: { path: '^packages/(?:user|recruitment|matching)/src/domain/' },
      to: {
        path: '(?:^packages/[^/]+/src/(?:persistence|models|agent|platform/connectors|mail/connectors)/|better-sqlite3|drizzle-orm|playwright|pdfjs-dist|tesseract|mammoth|imapflow|mailparser)',
      },
    },
    {
      name: 'common-does-not-import-business',
      comment: 'Common runtime and contracts must stay independent of business packages.',
      severity: 'error',
      from: { path: '^packages/common/' },
      to: { path: '^packages/(recruitment|user|matching)/' },
    },
    {
      name: 'recruitment-does-not-import-other-business',
      comment: 'Recruitment communicates with other business modules at process entries.',
      severity: 'error',
      from: { path: '^packages/recruitment/' },
      to: { path: '^packages/(user|matching)/' },
    },
    {
      name: 'user-does-not-import-other-business',
      comment: 'User communicates with other business modules at process entries.',
      severity: 'error',
      from: { path: '^packages/user/' },
      to: { path: '^packages/(recruitment|matching)/' },
    },
    {
      name: 'matching-reads-business-contracts-only',
      comment: 'Matching may depend only on public read contracts of recruitment and user.',
      severity: 'error',
      from: { path: '^packages/matching/' },
      to: { path: '^packages/(recruitment|user)/src/(?!contracts/)' },
    },
    {
      name: 'apps-use-package-exports',
      comment: 'Process entry points must use package public exports.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/[^/]+/src/(?!index\\.(?:ts|tsx)$)' },
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)\\.next[^/]*/|(^|/)dist/|(^|/)fixtures/' },
    includeOnly: '^(apps|packages)/',
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
