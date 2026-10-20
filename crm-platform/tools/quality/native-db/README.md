# Run the database-backed suites without Docker

`apps/api/test/integration` and `test/e2e` start a Postgres and a Redis per test file through Testcontainers. This folder swaps those two
containers for native processes so the suites run on a machine with no Docker daemon (a cloud sandbox, a CI image). Nothing in the suites changes.

Needs: Linux, root, `postgresql-16`, pgvector 0.8 (`postgresql-16-pgvector` is 0.6, which lacks `halfvec`: build 0.8 from source), `redis-server`.

```bash
bash tools/quality/native-db/build-template.sh                 # once: an empty UTF-8 cluster, copied for each test file
cp tools/quality/native-db/vitest.native.config.ts apps/api/  # alias config
cd apps/api
REDIS_URL=redis://localhost:6379 pnpm exec vitest run --config vitest.native.config.ts test/integration   # a Redis on 6379 for the 4 files that read REDIS_URL
```

Full write-up, results and the failures it found: [docs/quality/db-suites-run.md](../../../docs/quality/db-suites-run.md).
