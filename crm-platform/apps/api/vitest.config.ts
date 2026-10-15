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
      // Floors set a little under the first measurement (14 Oct 2026: rules 97.7% lines and 91.5% branches, common 81.4% and 85.9%,
      // mappers 34.4% and 77.0%) so nothing slips back; raise them as tests land, never lower them to get green. They are checked on a
      // full run (`pnpm --filter @crm/api test:coverage`), not on a run of one file. Services and repositories need a database and are
      // not gated here.
      thresholds: {
        'src/**/*-rules.ts': { lines: 95, branches: 88 },
        'src/**/*.rules.ts': { lines: 95, branches: 88 },
        'src/common/**/*.ts': { lines: 78, branches: 82 },
        'src/**/*.mapper.ts': { lines: 30, branches: 70 },
      },
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
