# Dependency audit and updates

## What CI does

`CI` (`.github/workflows/ci.yml`) runs `pnpm audit --prod --audit-level=high` on every pull request. It looks at production
dependencies only (what ships in the images), and **high and critical advisories fail the build**. Moderate and low are
reported but do not block; look at them when you are in the area. Dependabot (`.github/dependabot.yml`) opens a PR every Monday:
minor and patch bumps grouped into one, each major on its own.

Run it yourself: `pnpm audit --prod`. The list of what is accepted is in `package.json` under `pnpm.auditConfig.ignoreGhsas`.

## Accepted findings

Only add a finding here with a reason a reviewer can check, and remove it when the fix lands.

| Advisory                                                                        | Package              | Why it is accepted                                                                                                                                                                                                                                                                                                             | Exit                                                                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) (high) | `drizzle-orm` 0.38.4 | SQL injection when **untrusted input** reaches `sql.identifier()` or `.as()`. The code has three `sql.identifier()` calls (`plan-analytics.service.ts`, `plan-retention.service.ts`, `partition-maintenance.service.ts`); each takes a name from a constant list or from `pg_class`, never from a request. Checked 2026-10-04. | Upgrade to `>=0.45.2` in its own PR (seven minor versions; run the whole suite). Until then **never pass request data to `sql.identifier()` or `.as()`.** |

## Fixed by an override

- `multer` is forced to `>=2.4.0` (`pnpm.overrides`). 2.4 rejects a non-integer `limits.fileSize` (`TypeError` at startup, which would have taken the API down); the one fractional limit in the code (`2.1 * 1024 * 1024` in the settings controller) is rounded up. `@nestjs/platform-express` 11.2.5 pins 2.2.0, which has four advisories
  (three high: denial of service through crafted multipart field names, a descriptor leak on abort, an oversized array index; one
  moderate in 2.2 to 2.3). Drop the override once Nest ships a release that depends on a fixed multer.

## Fixed by an upgrade

- `@sentry/node` 8.55 pulled `@opentelemetry/core` below 2.8.0 (unbounded allocation in baggage propagation) and
  `@opentelemetry/instrumentation-pg`, `-mysql`, `-mysql2`, `-knex`, `-mongoose` and `-tedious` (they put the database user name in
  span attributes): seven moderate advisories. `apps/api` is on `@sentry/node` 11, which no longer depends on them. Sentry 11 collects far
  more than 8 did unless told otherwise, so `initSentry` switches every data category off explicitly (`NO_EXTRA_DATA` in
  `observability/sentry.ts`); keep that list when upgrading Sentry again.

## Known, not blocking (moderate)

- `js-yaml` 5.0 to 5.4.0 (CPU use on a merge-key file). Used by tooling on files in the repository, not on input.

## When the audit fails on your PR

1. `pnpm audit --prod` shows the path. If a newer version of the direct dependency fixes it, bump that.
2. If only a transitive package is behind, add a `pnpm.overrides` entry (and say why here).
3. If it cannot be fixed now and is not reachable from untrusted input, add its GHSA id to `ignoreGhsas` **and a row above**, in the
   same PR, so the next person can see why.
