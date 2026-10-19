# API and query timing report

`index.html` lists every API route (1,936), the ones over 300 ms p95 first, then the 200 to 300 ms watch list, every DB statement over 50 ms mean, and
what could not be measured and why. `results/` holds the raw numbers it was built from.

## Rerun (no Docker)

```bash
brew install postgresql@16 redis            # pgvector for 16: build from source (github.com/pgvector/pgvector, make PG_CONFIG=...)
# a scratch cluster with pg_stat_statements loaded, on a spare port; macOS needs LC_ALL=en_US.UTF-8
initdb -D /tmp/pgdata -U crm --auth=trust && LC_ALL=en_US.UTF-8 pg_ctl -D /tmp/pgdata -o "-p 5433 -c shared_preload_libraries=pg_stat_statements" start
psql -p 5433 -U crm -d postgres -c "CREATE DATABASE crm"; psql -p 5433 -U crm -d crm -f docker/postgres/init/01-app-roles.sql
pnpm db:migrate && pnpm --filter @crm/api build                  # env: DATABASE_URL / MIGRATION_DATABASE_URL on :5433, REDIS_URL, .github/workflows/perf.yml has the rest
# start the API (production mode), sign up perf1@geta.ai, then fill the organisation:
psql -p 5433 -U crm -d crm -v org=perf-org -f tools/perf/seed.sql
OPERATOR_PASSWORD='...' pnpm --filter @crm/api operator:create -- --email perfops@geta.ai --name "Perf Ops" --role super_admin
OPERATOR_EMAIL=perfops@geta.ai PSQL=$(which psql) PSQL_URL=postgres://crm@localhost:5433/crm node tools/api-inventory/measure.mjs --out perf/results
node tools/api-inventory/build.mjs --results perf/results
node --test tools/api-inventory/*.test.mjs
```

## What the numbers mean

One machine, the API, Postgres and Redis together, one user at a time, 7 timed calls per route after one warm-up (p95 of 7 is close to the slowest call).
Only GET routes are called; a write needs a valid body and changes data, so the 1,160 writes are listed as not run, never guessed. The organisation has
100,000 contacts and 1,000,000 messages: far larger than a new workspace, so the message-history and inbox figures are a worst case, not a typical one.
A 404 for a path parameter means the seeded data had no such record; it is not a fast route. A latency figure here is a trend and a ranking, not a production number. Run it on a quiet machine: another process using a core (a headless browser, a build) moved the same route's p95 from 284 ms to 1,707 ms between two back-to-back runs. For a change to one statement, compare the old and the new statement back to back (psql `\timing`, same session) instead of the route.
