# Wiring map: DPDP compliance register (DPDP), a platform extension

Not a Reference feature: Reference has no operator compliance page, so there is no twin to compare with. Spec:
[dpdp-compliance-register.md](../../specs/dpdp-compliance-register.md); the catalog comes from section 3 of
[dpdpa-gap-analysis-and-plan.md](../../privacy/dpdpa-gap-analysis-and-plan.md); the difference is recorded in
[product-extensions.md](../parity/product-extensions.md). Update this file in the same change as anything that adds, removes or re-decides a
check, flips a catalog row, or reads or writes the table below.

## Route, permission, table

| Surface                                                  | Where                                                                                                                                                                                                                                                      | Gate                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Screen `/admin/dpdp-register` (Team & security hub)      | `apps/web/src/features/dpdp-register/platform`, route `apps/web/src/app/(admin)/(dpdp-register)`                                                                                                                                                           | operator session; the Attest button only for `super_admin`, History for every role                                        |
| API `GET /v2/platform/dpdp-register`                     | `apps/api/src/modules/dpdp-register` (`DpdpRegisterController`)                                                                                                                                                                                            | `@ActorKinds('platform_operator')`, `OperatorGuard`, roles `super_admin`, `support`, `auditor`                            |
| API `GET /v2/platform/dpdp-register/checks/:key/history` | same controller                                                                                                                                                                                                                                            | same three roles; `:key` must be an attestable check, else 422                                                            |
| API `POST /v2/platform/dpdp-register/checks/:key/attest` | same controller, `DpdpRegisterService.attest`                                                                                                                                                                                                              | `super_admin` only; `:key` must be an attestable check, else 422; body `dpdpAttestInputSchema`                            |
| Contract                                                 | `packages/contracts/src/dpdp-register/` (`catalog.ts`, `checks.ts`, `status.ts`, `register.ts`)                                                                                                                                                            | shared by API and web                                                                                                     |
| Table                                                    | `dpdp_register_attestations` (migration `20261216090000`), no `org_id`                                                                                                                                                                                     | forced RLS, one `platform_only` policy on `app_is_privileged()`; append-only (no UPDATE/DELETE grant, plus a row trigger) |
| Menu                                                     | `features/dpdp-register/platform/operator-nav.ts`, merged by `features/auth-registration-security/platform/operator-nav.ts`; hub `team` in `features/admin-console-shell/console-layout.ts` (after Security events), search words in `console-keywords.ts` | like every operator page                                                                                                  |
| Texts                                                    | `apps/web/messages/<locale>/dpdp-register-admin.json`, 21 locales                                                                                                                                                                                          | no help guide (the operator console is outside the help center), no `pending.json` entry                                  |
| Settings                                                 | none                                                                                                                                                                                                                                                       | no platform permission key, no workspace setting, no feature flag                                                         |

No tenant user and no workspace data is involved: the page is platform-wide and the table holds no `org_id`. A tenant user and an
anonymous call are refused.

## What reads what (upstream feeders)

The API runs ten live probes at request time (`probes.ts`, one read per check, each cut off after 5 seconds and turned into `unknown` when it
fails; a probe never returns `pass` on an error). The service builds the dependencies, the pure `rules.ts` decides every status.

| Check key                  | Reads                                                                                                                                           | Upstream service or file                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `mfa.operators`            | `requireMfaForSuperAdmins` of the platform security policy                                                                                      | `SecurityPolicyService.policy()` (`modules/auth`)                                           |
| `mfa.workspace_admins`     | `requireMfaForAdmins` of the same policy                                                                                                        | `SecurityPolicyService.policy()`                                                            |
| `logs.audit_retention`     | `auditLogRetentionDays` of the same policy (0 means never pruned)                                                                               | `SecurityPolicyService.policy()`; the prune is `AuthMaintenanceService`                     |
| `logs.session_retention`   | `ENDED_SESSION_RETENTION_DAYS`, the constant the daily session purge uses                                                                       | `modules/auth/maintenance/auth-maintenance.service.ts` (exported for this page)             |
| `redis.auth`               | `REDIS_URL`: a password or `rediss:`                                                                                                            | `ConfigService`                                                                             |
| `crypto.rotation_complete` | `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS`: empty                                                                                                   | `ConfigService`                                                                             |
| `lifecycle.enabled`        | `ORG_LIFECYCLE_ENABLED`, `ORG_LIFECYCLE_DRY_RUN`, `ORG_LIFECYCLE_DELETE_ENABLED`, parsed with the app's own `envSchema`                         | `ConfigService`, `config/env.schema.ts`                                                     |
| `errors.vendor_region`     | whether Sentry runs and the region of the DSN host (`*.ingest.in.sentry.io` passes, `us` and `de` hosts fail, any other host is `unknown`)      | `sentryEnabled()` (`modules/platform-infrastructure`), `SENTRY_DSN` through `ConfigService` |
| `ai.platform_key_off`      | whether any LLM provider has a platform-level key                                                                                               | `AiKeyResolver.resolve(null, slug)` (`modules/ai-keys-usage-admin`)                         |
| `consent.default_opt_in`   | the contract default `CONSENT_SETTINGS_DEFAULTS.requireConsentForMarketing`, with the adoption counts of `contact_consent_settings` for context | `@crm/contracts`, `PlatformStore.tx` (privileged aggregate read)                            |

The probes show the key or number they read in a short detail text; no secret reaches the response (not the Redis URL, not the DSN, not a
key). The eight attestable checks (`hosting.region_documented`, `storage.encrypted_at_rest`, `backup.offsite_configured`,
`backup.restore_drill`, `security.pentest_report`, `legal.counsel_engaged`, `legal.vendor_dpas`, `governance.contacts_named`) are read from
`dpdp_register_attestations`: the newest row per key counts until `expires_at`, then the check is `unknown`. The eight code checks
(`DPDP_CODE_CHECK_RESULTS` in `catalog.ts`) are fixed results declared in the catalog; each is `fail` today and the change that ships its fix
flips it in the same PR.

## Consumers of the checks (every place they are used)

| Consumer                                                               | What it takes                                                                                                                                                                                            | State                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Register page (`/admin/dpdp-register`)                                 | `GET /v2/platform/dpdp-register`: milestones, summary, 47 items in groups A to I with their checks                                                                                                       | built                                          |
| Attest dialog (per attestable check, `super_admin` only)               | `POST .../checks/:key/attest` with `result`, `note` (10 to 2000 characters), optional https `evidenceUrl`, `expiresInDays` (1 to 365, default 90); the answer is the fresh register                      | built                                          |
| History list (per attestable check)                                    | `GET .../checks/:key/history`: up to 100 rows, newest first, who and when                                                                                                                                | built                                          |
| Security events (`security_events`, the operator Security events page) | one `dpdp_register.attested` row per attestation, written in the same transaction by `AuthAuditService` (actor `platform_operator`; the payload names the row and leaves the note and link in the table) | built                                          |
| Later DP slices (plan items DP-nn)                                     | flip the baseline or a code check of the rows they close, in the same PR                                                                                                                                 | by design (catalog drift test pins the totals) |
| Privacy registry (`modules/privacy/registry/allowlist.ts`)             | none: the table holds only the id of the operator who attested, no contact data                                                                                                                          | not listed                                     |

## Files

- Contract: `packages/contracts/src/dpdp-register/` (47-row catalog, check keys, status model, request and response shapes).
- Migration: `packages/db/migrations/20261216090000_dpdp_register_attestations.sql`; the table is classified `PLATFORM_ONLY` in
  `tools/tenancy-audit/policy/table-classification.json`.
- API: `apps/api/src/modules/dpdp-register/` (`module`, `controller`, `service`, pure `rules.ts`, `probes.ts`); registered in
  `apps/api/src/app.module.ts`.
- Web: `apps/web/src/features/dpdp-register/platform/` (`dpdp-register-page`, `summary-strip`, `register-list`, `attest-dialog`,
  `history-list`, `logic`, `queries`, `operator-nav`); route `apps/web/src/app/(admin)/(dpdp-register)/admin/dpdp-register/page.tsx`.

## Tests

- API unit: `apps/api/test/unit/dpdp-register/` (`catalog.spec.ts` pins 47 unique ids and the baseline-only totals of the plan; `rules.spec.ts`
  covers the status table; `probes.spec.ts` covers every probe, including a failing dependency).
- API e2e: `apps/api/test/e2e/dpdp-register/dpdp-register.e2e.spec.ts` (roles, attest then read, expiry, history order, the append-only table,
  the `security_events` row, a failing or hanging dependency).
- Web: `apps/web/src/features/dpdp-register/platform/logic.test.ts`, `dpdp-register-page.test.tsx`, and
  `apps/web/src/features/dpdp-register/messages.test.ts` (keys across the 21 locales).

## Open

- Reference parity: skipped on the owner's word on 17 Oct 2026 (no Reference twin); see [product-extensions.md](../parity/product-extensions.md).
- Counsel question 11 of the plan (which provision is the right citation for row 46; the register shows the enforcement heading).
- Every row whose status comes from a baseline or a code check changes only when the plan item that closes it ships.
- Probe scope: the live probes read the API process (its configuration and its Sentry). The worker, which runs the lifecycle sweep, has its own
  environment, so `lifecycle.enabled` and `errors.vendor_region` show what the API has, not proof of what the worker runs.
- `ai.platform_key_off` looks at LLM providers only. A platform key for a voice provider (ElevenLabs, Deepgram) is not counted, while section
  4.1 of the spec says "any provider". Owner decision; the change is one line in `dpdp-register.service.ts` plus a test.
- `attested_by` references `platform_operators (id)` with no `ON DELETE` action, so an operator row that has attested cannot be deleted
  (nothing deletes operators today).
