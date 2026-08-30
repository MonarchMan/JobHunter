const packageNames = [
  'agent-core',
  'application',
  'db',
  'domain',
  'llm',
  'matching',
  'observability',
  'resume',
  'source-core',
  'sources',
  'testkit',
];

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
      from: { path: '^packages/domain/' },
      to: { path: '^packages/(?!domain/)' },
    },
    {
      name: 'application-does-not-import-infrastructure',
      comment: 'Infrastructure implements application ports and is composed by apps.',
      severity: 'error',
      from: { path: '^packages/application/' },
      to: { path: '^packages/(db|sources|llm|observability)/' },
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
    exclude: { path: '(^|/)\\.next[^/]*/|(^|/)dist/|(^|/)test/fixtures/' },
    includeOnly: '^(apps|packages)/',
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
