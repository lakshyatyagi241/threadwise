/**
 * Layering for the mobile app (docs/adr/0024). Checked by `pnpm arch`, which CI and the pre-pr gate run.
 *
 *   app (routes)  ->  features  ->  components, lib, config
 *                     components ->  lib, config
 *                     lib        ->  lib, config
 *                     config     ->  nothing of ours
 *
 * A feature never imports another feature: when two screens need the same thing it moves down into lib/ or components/.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle between files makes module load order matter. Break it by moving the shared part down a layer.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'lib-is-below-everything',
      severity: 'error',
      comment: 'lib/ is the bottom layer: it may not import features, components or routes.',
      from: { path: '^src/lib' },
      to: { path: '^src/(features|components|app)' },
    },
    {
      name: 'components-do-not-know-features',
      severity: 'error',
      comment: 'components/ is shared UI: it may not import features or routes.',
      from: { path: '^src/components' },
      to: { path: '^src/(features|app)' },
    },
    {
      name: 'features-are-independent',
      severity: 'error',
      comment:
        'A feature may not import another feature. Move the shared part to lib/ or components/.',
      from: { path: '^src/features/([^/]+)/' },
      to: { path: '^src/features/([^/]+)/', pathNot: '^src/features/$1/' },
    },
    {
      name: 'features-do-not-know-routes',
      severity: 'error',
      comment: 'Routes (src/app) compose features, never the other way round.',
      from: { path: '^src/features' },
      to: { path: '^src/app' },
    },
    {
      name: 'config-is-a-leaf',
      severity: 'error',
      from: { path: '^src/config' },
      to: { path: '^src/(lib|features|components|app)' },
    },
    {
      name: 'tests-stay-out-of-production-code',
      severity: 'error',
      from: { pathNot: '\.(test|spec)\.[jt]sx?$|jest\.' },
      to: { path: '\.(test|spec)\.[jt]sx?$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '\.d\.ts$' },
  },
};
