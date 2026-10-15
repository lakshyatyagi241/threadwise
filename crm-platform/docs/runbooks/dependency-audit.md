# Dependency audit and updates

## What runs, and when

Nothing runs automatically: the check workflows were removed in #328 because GitHub Actions jobs do not start on this account. Run the
scans yourself with `bash tools/quality/security-scan.sh` (add `--images` to build and scan both Docker images), or start the
**Security** workflow (`.github/workflows/security.yml`) from the Actions tab once the account is paid up. The release workflow
(`deploy.yml`) still scans both images before they ship. The scans:

1. `pnpm audit` twice (production dependencies, and everything), judged by `tools/quality/audit-gate.mjs`;
2. Trivy over `pnpm-lock.yaml`, a second vulnerability database, for fixable high and critical findings in production;
3. Gitleaks over the whole git history, and Trivy over the two Docker images.

The gate's rules: a **high or critical advisory in a production dependency fails**; a **critical advisory in a development
dependency fails** (development high is listed, not blocking); a reviewed decision **past its end date fails**. Moderate and low are
reported by `pnpm audit` and not blocking; look at them when you are in the area. Dependabot (`.github/dependabot.yml`) opens a PR every Monday: minor and patch bumps grouped into one,
each major on its own.

Run it yourself:

```bash
pnpm audit --prod --json > /tmp/prod.json; pnpm audit --json > /tmp/all.json
node tools/quality/audit-gate.mjs /tmp/prod.json /tmp/all.json
node --test tools/quality/audit-gate.test.mjs
```

## Accepted findings

Only in `.audit-accepted.json`, each with the advisory id, a reason a reviewer can check, an end date and the way out. Remove the entry
when the fix lands. `pnpm.auditConfig.ignoreGhsas` in `package.json` is empty on purpose: the old `drizzle-orm` entry was removed when the
package was already on 0.45.3 (the fixed line).

| Advisory                                            | Package                     | Why accepted                                                                             | Ends       |
| --------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| GHSA-5xrq-8626-4rwp (critical)                      | `vitest` 2.1.9              | Only when the Vitest UI server is listening; never run. Development only.                | 2026-12-31 |
| GHSA-85c8-ppgw-ccpr, GHSA-5gmw-xhrv-c9v3 (critical) | `tinypool` 1.1.1 via vitest | Worker options must be attacker-controlled; the tests pass fixed ones. Development only. | 2026-12-31 |

Way out for all three: move to `vitest` 3.2.6 or later in its own PR (major version; run the API, web and package suites).
Development-only high findings that are listed but not blocking: `undici` 5.29.0 and `@fastify/busboy` (through `testcontainers`),
`vite` 5.4.21 (through vitest), `braces` 3.0.3 (through `lint-staged`, no fixed release exists).

## Fixed by an override

- `source-map-js` is forced to `>=1.2.2` (GHSA-68fv-2mgg-jv7q, high: event-loop denial of service through crafted source maps). It was reached through `sanitize-html` → `postcss` in the API and was the first finding of the daily scan. Drop the override once `postcss` ships a release that depends on a fixed version.
- `@grpc/grpc-js` is forced to `>=1.14.5` (GHSA-m9gg-hp2v-232j, high), reached through `testcontainers` → `dockerode`. Development only; a patch release, so the override is safe.

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
