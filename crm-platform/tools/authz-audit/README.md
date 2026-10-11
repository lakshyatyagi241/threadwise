# Authorization / IDOR audit

Sibling of `tools/auth-audit` (authentication). Answers: can each actor do only what it is explicitly allowed to, on the objects and
fields it is allowed to, inside its own tenant?

```bash
pnpm audit:authz                    # route inventory + policy matrix + static checks (seconds, no Docker)
pnpm audit:authz -- --dynamic       # + generated matrix and deep e2e specs (Docker Desktop must run; ~15-30 min)
pnpm audit:authz -- --dynamic --strict   # CONDITIONAL also exits non-zero (pre-release)
node tools/authz-audit/inventory.mjs     # only the route inventory + summary
```

Windows: set `SWC_NATIVE_BINDING_CACHE` (see the auth-audit README) if vitest refuses to load.

## What it produces (`reports/authz-audit/latest/`, git-ignored)

| File                                    | What                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `authorization-route-inventory.json`    | every controller route: gates, real URL, object-id params                             |
| `authorization-policy-matrix.csv`       | route x actor class -> ALLOW / DENY / CONDITIONAL / POLICY-UNDEFINED                  |
| `authorization-control-matrix.csv`      | the 100 controls, status Pass / Fail / Needs decision / Partial / Not run / Not assessed |
| `authorization-security-findings.json`  | open findings and decisions needed                                                    |
| `authorization-test-results.json`       | what the dynamic suites ran                                                           |
| `matrix-results.json`                   | raw probes of the generated matrix, including everything that could NOT be tested     |
| `authorization-release-certification.json` | verdict (GO / CONDITIONAL / NO-GO) and blocker list                                |
| `report.md`                             | the same, readable                                                                    |

## Layers

1. **Static** (`lib/static-checks.mjs`): deny-by-default, declared policy for every authenticated-only route (`policy/self-service.json`),
   operator-route granularity, privileged fields in contracts, cache keys, queue payloads, WebSocket rooms, API-key scope semantics.
2. **Generated matrix** (`apps/api/test/e2e/authz/route-matrix.e2e.spec.ts`): for EVERY route found by `lib/routes.mjs`, anonymous,
   no-grant member, tenant admin on operator routes, operator on workspace routes, exact-key member, and tenant B on tenant A's ids,
   with row-count / `updated_at` snapshots proving a denial changed nothing. New endpoints are covered the day they are added.
3. **Deep specs** (same folder): `idor-families`, `lifecycle` (roles, membership, sessions), `api-key-scopes`, and the field-level,
   realtime, workers, bulk/export and cache/race specs. `lib/controls.mjs` maps each control to the spec file that is its evidence.

A control is `Pass` only when its static check passed or **every** test of its spec file ran and passed. A skipped, missing or
non-running check is "Not run" / "Not assessed", never a pass.

## Decisions and exceptions

- `policy/self-service.json`: every route that has no `@RequirePermission` but is allowed to any signed-in member, with the reason.
  An undeclared one fails the audit (`policy-declared`). Adding an entry requires reading the handler.
- `decisions.json` (same format as `tools/auth-audit/decisions.example.json`): `accepted` / `deferred` with reason, owner, date, expiry.
  Business policy that the code cannot decide (can a manager export? may every operator role reach this route?) is recorded here by a
  human; the audit never decides it.

## Adding a check or a spec

- New endpoint: nothing to do for the matrix; if it is authenticated-only, add it to `policy/self-service.json`.
- New resource family: add it to `idor-families.e2e.spec.ts` (create in tenant A, attack as B and as a no-permission/own-scope member).
- New spec file: list it under the right controls in `lib/controls.mjs`.

## Limits

An automated run cannot prove the absence of vulnerabilities. It does not cover production data, third-party providers' own
authorization, or business rules that no one has written down (these show up as POLICY-UNDEFINED or Needs decision).
