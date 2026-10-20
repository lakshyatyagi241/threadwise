# Docker-free API tests (BL-395)

`TEST_NO_DOCKER=1` runs the API integration and e2e suites without Docker. Default (variable unset) is unchanged: the specs start
containers through testcontainers.

```bash
pnpm --filter @crm/api test:integration:nodocker
pnpm --filter @crm/api test:e2e:nodocker
cd apps/api && TEST_NO_DOCKER=1 npx vitest run test/integration/db-guards.spec.ts --testTimeout=120000
```

## How it works

- `apps/api/vitest.config.ts` (only when `TEST_NO_DOCKER=1`) aliases `@testcontainers/postgresql` to `postgresql-shim.ts` and
  `testcontainers` to `testcontainers-shim.ts`. The specs are not edited. Code that vite does not transform (node_modules) still
  imports the real packages; the shims import neither.
- `PostgreSqlContainer.start()` creates a NEW Postgres 16 cluster (`initdb`) in `/tmp/tc_nodocker_pg_<run>_<pid>_<rand>` in the WSL
  distro `Ubuntu-24.04`, on a random free port (21000 to 31999, below the ephemeral ranges), listening on `127.0.0.1`, with
  `fsync=off synchronous_commit=off full_page_writes=off shared_buffers=16MB max_connections=100 jit=off`, user/password/database as the spec asked
  (scram auth), then returns host `127.0.0.1` and that port. Roles are cluster-global, so each spec gets its own cluster, like a container.
  `withCommand([... '-c', 'k=v'])` settings are applied; other builder methods are no-ops. `stop()` stops the cluster and deletes the directory.
- `GenericContainer('redis:*')` starts a `redis-server` (no persistence, 64 MB cap) on a free port. Any other image throws a
  "needs Docker" error.
- `wsl-ctl.sh` does the work inside WSL; `wsl-runtime.ts` pipes it to `wsl.exe -d Ubuntu-24.04 -u root --exec bash -s` over stdin.
- If `127.0.0.1:<port>` does not answer within 8 s (WSL port forwarding broken), the WSL VM address (`hostname -I`) is returned instead.
  `TEST_NO_DOCKER_HOST` forces a host.
- Parallelism: vitest runs `TEST_NO_DOCKER_WORKERS` spec files at once (default 4; each cluster is about 50 MB, the WSL VM is capped at
  2 GB by `~/.wslconfig`). Use 2 if the machine is busy.

## Cleanup

Each run has a tag (`global-setup.ts`); its teardown removes everything the run started, even when a worker was killed. Exit and signal
hooks in every worker do the same. After a hard kill of the whole run: `pnpm --filter @crm/api test:nodocker:clean` (removes all
`tc_nodocker_*` clusters and Redis servers; `node scripts/test-no-docker-clean.mjs --list` shows them). Every start also reaps
leftovers older than 3 hours. The shared dev cluster (`16/main`, port 55710) and its Redis (56710) are never touched.

## Requirements and limits

- Windows with WSL2, distro `Ubuntu-24.04` (override with `TEST_NO_DOCKER_DISTRO`) with PostgreSQL 16 (+ pgvector, contrib) and Redis 7
  installed; see `_work/shared-db/wsl-setup.sh`. Docker Desktop stays off.
- `channel-email/imap-mail.e2e.spec.ts` (GreenMail, a Java mail server image) is excluded in this mode.
- Not supported: `exec`, `logs`, `Wait` strategies (accepted and ignored), images other than Postgres and Redis.
- Use `127.0.0.1`, never `localhost`.
