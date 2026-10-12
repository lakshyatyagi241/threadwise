# Multi-tenancy isolation audit

Sibling of `tools/auth-audit` and `tools/authz-audit`. Answers: can one workspace read, change, delete, trigger or consume
another workspace's data, even though they share the database, Redis, queues and workers? The model is shared database,
`org_id` on every tenant table, forced Row-Level Security (see `docs/architecture/multi-tenancy.md`).

```bash
pnpm audit:tenancy -- --static   # code scans only (seconds, no database)
pnpm audit:tenancy               # + catalog inventory + generated cross-tenant DB probe (needs a THROWAWAY Postgres)
```

Environment for the database part (a migrated scratch database, never real data: the probe writes and deletes synthetic rows and
briefly drops and re-adds CHECK constraints on tables whose CHECKs the generic seed cannot satisfy):

| Variable                   | Role                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `MIGRATION_DATABASE_URL`   | owner / superuser, seeds across tenants and inspects ground truth     |
| `TENANCY_APP_DATABASE_URL` | the restricted app role (NOSUPERUSER NOBYPASSRLS), what is under test |

Output goes to `reports/tenancy-audit/latest/` (git-ignored): `report.md`, `tenant-entity-inventory.csv`,
`tenant-isolation-test-results.json`, `tenant-control-matrix.json`, `tenant-cache-queue-audit.json`,
`tenant-security-findings.json`, `tenant-isolation-release-certification.json`.

## What is executed

1. **Catalog inventory** (MT-001/002): every table, `org_id` or not, RLS enabled and forced, policies. A table without `org_id` must be
   classified in `policy/table-classification.json` (GLOBAL / PLATFORM_ONLY / SHARED_AUTHORIZED / TENANT_ROOT); otherwise it is
   UNCLASSIFIED and the verdict is NO-GO.
2. **Generated DB probe** (`lib/db-probe.mjs`, MT-005/011..014): for every table with `org_id`, one row per tenant is seeded and then, as the
   restricted role: own rows visible (positive control), foreign rows invisible, no context sees nothing, cross-tenant UPDATE and
   DELETE touch nothing (checked from the owner's side), cross-tenant INSERT is refused by `WITH CHECK` (SQLSTATE 42501).
   The same probe runs in CI as `apps/api/test/integration/tenancy-isolation.generated.spec.ts`. A `BLOCKED` table (could not seed)
   fails that spec: teach `db-probe.mjs` how to seed it, never skip it.
3. **Static scans** (`lib/code-scan.mjs`): every `privileged()` call-site file must be on `policy/privileged-allowlist.json`
   (a new one fails until someone reads it and records why); every queue processor must establish a tenant context or be declared in
   `policy/processor-declarations.json`; Redis key templates with no org token are listed in `policy/redis-reviewed.json`.
4. **Executed e2e evidence** (API, workers, realtime, files/exports, AI retrieval, webhooks, concurrency): `run.mjs` reads vitest JSON
   reports and maps them onto the MT controls through `policy/controls.json`.
   - the authz dynamic suite: `pnpm audit:authz -- --dynamic` writes `reports/authz-audit/latest/vitest-authz.json`;
   - everything below in one go: `node tools/tenancy-audit/collect-e2e.mjs` (Docker for the e2e specs, `REDIS_URL` for the two Redis integration specs);
   - module isolation suites and this audit's own specs, one JSON per spec in `reports/tenancy-audit/e2e/<name>.json`, produced with
     `vitest run <spec> -t "isolation|cross-tenant|another workspace|other workspace" --reporter=json --outputFile=...`
     (`<name>` is the spec file name without `.e2e.spec.ts`).
     A control is `PASSED` only if every spec it names ran at least one test and none failed. A report with no executed test is
     `BLOCKED`, a missing report is `NOT_RUN`.

## Specs that belong to this audit

| Spec                                                        | Pins                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `test/integration/tenancy-isolation.generated.spec.ts`      | the DB probe over every tenant table (CI)                                     |
| `test/e2e/tenancy/tenancy-regressions.e2e.spec.ts`          | TI-009 (subscription event matched by a shared plan id)                       |
| `test/e2e/tenancy/tenancy-concurrency.e2e.spec.ts`          | tenant context under interleaving, a pooled connection keeps no tenant, burst |
| `test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts` | TI-003 (manual connect with a WABA that does not list the phone)              |
| `test/unit/node-bridge-runtime/catalog-bridge.spec.ts`      | TI-008 (catalog bridge needs an explicit workspace outside a request)         |
| `test/unit/public-api/api-key-auth-throttle.spec.ts`        | TI-013 (failed API-key authentication throttle)                               |

## What is still NOT executed

Controls with no executed evidence stay `NOT_RUN` in `tenant-control-matrix.json`, and the verdict can be NO-GO or CONDITIONAL, never GO,
while any remain. As of the last run: migrations and backfills on existing data (MT-023), index / query-plan / pool contention
(MT-025, MT-094), distributed-lock scoping (MT-039, read but not executed), temp files and report jobs (MT-064), autocomplete (MT-066),
file retention (MT-071), prompt injection and AI report / session isolation (MT-089, 091, 092), tenant provisioning defaults (MT-095),
backup and restore (MT-097), and the process controls MT-099 / MT-100 (the CI workflow is added; they become PASSED after its first
green run). Controls whose requirement the audit found _unmet_ are `FAILED`, with the finding: MT-044 (TI-017), MT-057 (TI-016),
MT-093 (TI-015).

No load test (k6 or similar) has been run: the noisy-neighbour controls rest on a liveness check in one process, not on measured capacity.

## Verdict rules

`NO-GO`: a failed generated scenario, a tenant table without forced RLS and a policy, an unclassified table, a new unreviewed
`privileged()` call site, a failed P0 control, or an open release-blocking Critical/High finding.
`CONDITIONAL`: nothing blocks, but some control has no executed evidence, or a P1 control is unmet.
`GO` needs every control executed and passing. This tool does not claim more than it ran: an unexecuted control is listed, not passed.

## Windows / environment notes

- Set `SWC_NATIVE_BINDING_CACHE` to an owner-only directory and `TURBO_ENV_MODE=loose` (see `tools/auth-audit/README.md`).
- Build the workspace packages once in a fresh checkout (`pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax build`),
  otherwise every e2e spec fails at import.
- Several e2e specs hardcode a 240 s setup timeout. A full app boot takes 3 to 4 minutes on a laptop with the repo on a synced
  drive, so a spec can report `BLOCKED` for setup timeout rather than for a real failure.

## Policy files

- `policy/findings.json`: findings and owner decisions (resource, code location, exploitability, reproduction, fix, regression test).
- `policy/controls.json`: the proposed MT-001..MT-100 controls with priority and the basis for each status; regenerate with
  `node tools/tenancy-audit/policy/gen-controls.cjs`.
- `policy/privileged-allowlist.json`: one entry per file that calls `privileged()` and the outcome of its review
  (`reviewed`, `reviewed-fixed`, `reviewed-partial`: the reviewer could not trace every consumer).
- Entries marked `baseline-unreviewed` (none today) mean "listed so NEW sites fail", not "reviewed".
