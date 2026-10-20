# Local development

## First run

```bash
corepack enable pnpm
pnpm install

cp .env.example .env          # adjust ports if others are taken — see below

pnpm infra:up                 # postgres, redis, mailpit
pnpm --filter @crm/contracts build
pnpm --filter @crm/db build
pnpm --filter @crm/observability build
pnpm db:migrate
pnpm db:seed

pnpm dev                      # API on :3000
pnpm dev:worker               # in a second terminal
```

Check it:

```bash
curl localhost:3000/health    # {"status":"ok",...}
curl localhost:3000/ready     # dependency status
open  localhost:3000/docs     # Swagger
```

### Seeded logins

| Who         | Credentials                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| Staff admin | `nachiket.challawar@geta.ai` (org `Admin`, Clerk sign-in, no seeded password) |
| Sub-agent   | `agent@Admin.test` / `Passw0rd!` (org `Admin`)                                |

A **second tenant** (`othertenant`) is seeded on purpose. Isolation tests need
an org the first one must not be able to see — seeding one tenant makes working
RLS indistinguishable from absent RLS.

### Port conflicts

If another project already owns 5432/6379/9000/1025, change the host ports in
`.env` — the container-side ports never change:

```bash
POSTGRES_PORT=55432
REDIS_PORT=56379
MAILPIT_SMTP_PORT=51025
MAILPIT_UI_PORT=58025
```

Then update `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DATABASE_REPLICA_URL`,
`REDIS_URL`, `S3_ENDPOINT` and `SMTP_PORT` to match.

### Two database URLs — on purpose

| Variable                 | Role                               | Used by           |
| ------------------------ | ---------------------------------- | ----------------- |
| `DATABASE_URL`           | `crm_app_user` — **non-superuser** | the application   |
| `MIGRATION_DATABASE_URL` | `crm` — owner                      | migrations, seeds |

A superuser **bypasses RLS entirely**. If the app connects as the owner, every
isolation policy is in place and completely inert. This split is the thing that
makes the policies real. See
[multi-tenancy.md](../architecture/multi-tenancy.md).

## Daily commands

```bash
pnpm dev                 # API, watch mode (SWC)
pnpm dev:worker          # worker, watch mode
pnpm test                # unit tests
pnpm test:integration    # testcontainers — spins its own Postgres
pnpm typecheck
pnpm lint
pnpm arch:check          # module boundary rules
pnpm format

pnpm db:migrate          # apply pending
pnpm db:status           # what is applied, and whether anything diverged
pnpm db:new add_widgets  # create a timestamped migration file
pnpm db:reset            # drop schema, re-migrate, re-seed (dev only)

pnpm infra:up / infra:down / infra:logs
pnpm infra:nuke          # also deletes volumes — all local data gone
```

## Running tests without Docker (the owner's machine rule)

Docker Desktop makes the owner's machine hang and gets Claude sessions killed, so on this machine the API integration and e2e suites run
without it. Set `TEST_NO_DOCKER=1` (the package scripts do it for you) and every spec that would start a Postgres or Redis container
gets its own throwaway Postgres 16 cluster (pgvector included) or Redis inside the WSL distro `Ubuntu-24.04`, started and deleted per spec:

```bash
pnpm --filter @crm/api test:integration:nodocker              # all of test/integration
pnpm --filter @crm/api test:e2e:nodocker                      # all of test/e2e
cd apps/api && TEST_NO_DOCKER=1 npx vitest run test/integration/db-guards.spec.ts --testTimeout=120000   # one spec
pnpm --filter @crm/api test:nodocker:clean                    # stop and delete leftovers after a killed run
```

Four spec files run in parallel by default (`TEST_NO_DOCKER_WORKERS=2` lowers it; WSL is capped at 2 GB). The shared dev database (port 55710) is never touched. The GreenMail mail spec is skipped in this mode. Requirements, limits and how it works:
`apps/api/test/support/no-docker/README.md`. Without `TEST_NO_DOCKER` the specs use Docker as before.

## Local URLs

| Service | URL                                               |
| ------- | ------------------------------------------------- |
| API     | http://localhost:3000                             |
| Swagger | http://localhost:3000/docs                        |
| Mailpit | http://localhost:8025 (or your `MAILPIT_UI_PORT`) |

## Try the API

```bash
TOKEN=$(curl -s -X POST localhost:3000/v2/auth/staff/login \
  -H 'content-type: application/json' \
  -d '{"orgSlug":"Admin","email":"admin@example.test","password":"Passw0rd!"}' \
  | jq -r .accessToken)

curl "localhost:3000/v2/contacts?limit=5" -H "authorization: Bearer $TOKEN"

curl -X POST localhost:3000/v2/contacts \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: my-key-1' \
  -d '{"name":"Test Person","email":"test@example.com","phone":"+919000000001"}'
```

## Troubleshooting

**`Invalid environment configuration` on boot**
Working as designed — the app validates `.env` with Zod and refuses to start on
a bad value. The message lists every problem at once.

**`DATABASE_URL: Required` but `.env` exists**
The config module walks up from its own directory looking for `.env`. If you
moved things, check `apps/api/src/config/config.module.ts`.

**RLS tests fail / a tenant sees another tenant's rows**
You are connecting as a superuser. Check that `DATABASE_URL` uses
`crm_app_user`, and that `docker/postgres/init/01-app-roles.sql` ran (it only
runs on a fresh volume — `pnpm infra:nuke` then `infra:up`, or apply it by hand
with `psql`).

**`Migration X has changed since it was applied`**
You edited an applied migration. Applied migrations are immutable. Either
revert your edit and add a new migration, or `pnpm db:reset` in development.

**Port already allocated**
See _Port conflicts_ above.

**Integration tests are slow the first time**
Testcontainers is pulling `pgvector/pgvector:pg16`. Once cached, the suite runs
in ~15s.

## Windows: SWC cache, line endings, memory

- `ERR_SWC_NATIVE_CACHE` when building or running vitest: set `SWC_NATIVE_BINDING_CACHE` to a writable folder (for example
  `export SWC_NATIVE_BINDING_CACHE="$HOME/.swc-native-cache"`). `turbo.json` lists it (and `NODE_OPTIONS`) in `globalPassThroughEnv`, so
  `pnpm test`, `pnpm lint` and `pnpm typecheck` hand it to their tasks; `tools/dev-refresh.sh` and the pre-pr `gate.sh` set it for you.
- Line endings: `.gitattributes` checks text out as LF (`* text=auto eol=lf`), matching `.prettierrc`, so `pnpm format:check` is meaningful on
  Windows. An old checkout that still has CRLF files: run `pnpm exec prettier --end-of-line auto --check <files>`, or re-checkout.
- `pnpm lint` and the web `tsc` need `NODE_OPTIONS=--max-old-space-size=6144`, as on a CI runner (`gate.sh` sets it).
