import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    // Integration tests each own a Postgres container; running suites in
    // parallel would multiply containers and starve a laptop.
    fileParallelism: false,
    // Coverage of the business logic that unit tests can reach without a database: the *-rules, mappers, parsers and the
    // shared helpers. Services and repositories need Postgres and are measured by the e2e and integration suites, so they are
    // listed in the report (`tools/quality/coverage-metrics.mjs`) but not gated here. `pnpm --filter @crm/api test:coverage`.
    coverage: {
      provider: 'v8',
      // A failing test must not hide the coverage report: without this vitest writes none, and the baseline is lost.
      reportOnFailure: true,
      reporter: ['text-summary', 'json-summary', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.module.ts',
        '**/main.ts',
        '**/worker.ts',
        '**/*.controller.ts',
        '**/*.dto.ts',
        '**/index.ts',
        '**/*.d.ts',
        'src/tools/**',
        'test/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    // Nest's DI needs emitted decorator metadata, which esbuild (vitest's
    // default transformer) does not produce.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
});
