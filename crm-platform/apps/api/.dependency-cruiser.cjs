/**
 * Architecture boundaries for apps/api.
 *
 * Layering (outer may depend on inner, never the reverse):
 *
 *   modules/*  ->  kernel  ->  infra  ->  config
 *        \___________________/     \
 *              common              (leaf, may be used by all)
 *
 * The hard rule: a domain module may NOT reach into another domain module's
 * internals. Cross-domain traffic goes through the kernel (events/outbox) or
 * through the other module's public `index.ts` barrel.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports break Nest DI resolution and make modules untestable.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Domain modules must not import another domain module’s internals. Use its index.ts barrel, or go through the kernel outbox.',
      from: { path: '^src/modules/([^/]+)/.+' },
      to: {
        path: '^src/modules/([^/]+)/.+',
        pathNot: [
          '^src/modules/$1/.+', // same module: fine
          '^src/modules/[^/]+/index\\.ts$', // public barrel: fine
          // A leaf port file (`<name>.port.ts`, a token and types, no imports of its own): a consumer injects by token and imports only
          // this, so it does not pull the provider's module (and the modules that one imports) into its own file graph, where a cycle
          // can leave a class `undefined` while Nest reads its constructor. See modules/leads/lead-ingest.port.ts.
          '^src/modules/[^/]+/[^/]+\\.port\\.ts$',
        ],
      },
    },
    {
      name: 'port-files-are-leaves',
      severity: 'error',
      comment:
        'A `<name>.port.ts` file in a module is importable across modules only because it is a leaf: a token and types. It may import ' +
        'other port files and type-only imports (erased at runtime), nothing else from src/, or the exception in no-cross-module-internals ' +
        'would let a real dependency (and its import cycles) through.',
      from: { path: '^src/modules/[^/]+/[^/]+\\.port\\.ts$' },
      to: {
        path: '^src/',
        pathNot: '\\.port\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'kernel-must-not-depend-on-modules',
      severity: 'error',
      comment: 'The kernel is the platform. It cannot know about CRM/Inbox/Billing specifics.',
      from: { path: '^src/kernel/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'infra-must-not-depend-on-domain',
      severity: 'error',
      comment: 'infra/ is adapters only (db, redis, queue, s3, providers). No domain knowledge.',
      from: { path: '^src/infra/' },
      to: { path: '^src/(modules|kernel)/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$', '\\.config\\.ts$'] },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      from: { path: '^apps/api/src', pathNot: '\\.(spec|test)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['require', 'node'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
