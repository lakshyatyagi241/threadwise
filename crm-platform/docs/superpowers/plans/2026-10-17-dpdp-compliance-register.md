# DPDP Compliance Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super admin console page that always shows which of 47 DPDP obligations the platform follows and which it does not, from live probes, code-declared checks and recorded super admin attestations.

**Architecture:** A code catalog in `@crm/contracts` lists the 47 obligations and the checks behind them. A pure `evaluate()` in a new `dpdp-register` API module turns probe outcomes plus attestations into item statuses. Attestations live in one append-only platform table. A web page in the Team hub renders the result.

**Tech Stack:** NestJS, Postgres (raw SQL migration, forced RLS), Zod contracts, Next.js 15 App Router, next-intl, TanStack Query, Vitest, supertest.

**Spec:** `docs/specs/dpdp-compliance-register.md` (parent: `docs/privacy/dpdpa-gap-analysis-and-plan.md` section 3).

## Global Constraints

- Item statuses: `following`, `partial`, `not_following`, `not_applicable`, `unverified`. Check results: `pass`, `fail`, `unknown`. Check sources: `live`, `attested`, `code`.
- Resolution with P passes, F fails, U unknowns: F=0,U=0 gives `following`; F=0,U>0 gives `unverified`; F>0 and (P>0 or U>0) gives `partial`; F>0,P=0,U=0 gives `not_following`. An item with no checks takes its `baseline`. `not_applicable` is listed but not counted. A row is never `following` unless every check passed.
- Baseline-only totals over the 47 entries: 1 following, 26 partial, 20 not following.
- A probe that throws returns `unknown` with detail `probe_error`, never `pass`. An attestation with `expires_at <= now` is `unknown`.
- Attestation input: `result` pass or fail; `note` at least 10 characters; optional https `evidenceUrl`; `expiresInDays` 1 to 365, default 90. Only the 8 attestable keys are accepted; anything else is 422.
- Roles: `super_admin`, `support`, `auditor` read; only `super_admin` attests. No new platform permission key. Routes `/v2/platform/dpdp-register...`; every route has `@ApiTags('platform')` and `@ApiOperation`.
- Migration file `packages/db/migrations/20261216090000_dpdp_register_attestations.sql`. No `org_id`. Forced RLS, one `platform_only` policy on `app_is_privileged()`. Append-only. `attested_by` is `bigint` (`platform_operators.id` is bigint, not uuid).
- Every attestation writes a `security_events` row, event `dpdp_register.attested`, in the same transaction through `AuthAuditService.record`.
- Reads and writes of this table go through `PlatformStore.tx`, not `db.privileged`.
- Page in the `team` hub after `security-events`; nav id `dpdp-register`; address `/admin/dpdp-register`. All 21 locales (`messages/<locale>/dpdp-register-admin.json`). No help guide.
- Copy never says "compliant". Header text: "Tracks what the platform does today against the DPDP Act and Rules. It is not a compliance certificate."
- Milestones: 2026-11-14 (Consent Manager registration, rule 4) and 2027-05-14 (main duties); the text says "about".
- Repo rules: invoke the `add-migration` skill for the migration, `i18n-translate-sync` for locales, run `security-review-gate` and `bash .claude/skills/pre-pr/scripts/gate.sh` before calling it done. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Scopes: `contracts`, `db`, `api`, `web`, `docs`.

## Review Focus

- A probe throws or the DB read fails: the page still loads and that check shows `unknown` (Task 3, Task 4).
- An attestation whose `expires_at` equals `now` counts as expired (Task 3).
- `support` or `auditor` calls the attest route: 403; a tenant user or no token: 401 or 403 (Task 5).
- Unknown check key or note shorter than 10 characters: 422 and no row written (Task 5).
- A milestone date already passed: `daysLeft` is 0 and the milestone is marked passed, never negative (Task 3).

## File Structure

| File                                                                                          | Responsibility                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/contracts/src/dpdp-register/{status,checks,catalog,register,index}.ts`              | enums, check keys, the 47-item catalog, Zod input and response types |
| `packages/db/migrations/20261216090000_dpdp_register_attestations.sql`                        | the append-only table                                                |
| `apps/api/src/modules/dpdp-register/rules.ts`                                                 | pure `evaluate()`                                                    |
| `apps/api/src/modules/dpdp-register/probes.ts`                                                | live probes over injected dependencies                               |
| `apps/api/src/modules/dpdp-register/dpdp-register.{service,controller,module}.ts`, `index.ts` | wiring, persistence, routes                                          |
| `apps/web/src/features/dpdp-register/platform/*`                                              | page, list, summary, attest dialog, queries, filter logic, nav entry |
| `apps/web/messages/<locale>/dpdp-register-admin.json`                                         | texts                                                                |

---

### Task 1: Contracts and catalog

**Files:**

- Create: `packages/contracts/src/dpdp-register/status.ts`, `checks.ts`, `catalog.ts`, `register.ts`, `index.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './dpdp-register';` after the `compliance` export, line 106); `docs/specs/dpdp-compliance-register.md` (add section 4.3 "Code checks" listing the 8 code check keys, the rows they sit on and that each is `fail` until its feature ships)
- Test: `apps/api/test/unit/dpdp-register/catalog.spec.ts`

**Interfaces:**

- Produces (all from `@crm/contracts`):
  - `DPDP_ITEM_STATUSES`, `DPDP_CHECK_RESULTS`, `DPDP_CHECK_SOURCES`, `DPDP_GROUPS` (`'A'..'I'`), `DPDP_OWNERS` (`'tenant'|'platform'|'both'`), `DPDP_PENALTY_TIERS` (`'250'|'200'|'150'|'50'|'none'`) as `as const` arrays plus their union types `DpdpItemStatus`, `DpdpCheckResult`, `DpdpCheckSource`, `DpdpGroup`, `DpdpOwner`, `DpdpPenaltyTier`.
  - `DPDP_LIVE_CHECKS` (10 keys of spec 4.1), `DPDP_ATTESTABLE_CHECKS` (8 keys of spec 4.2), `DPDP_CODE_CHECKS` (the keys in the code-check table below), `DpdpLiveCheck`, `DpdpAttestableCheck`, `DpdpCodeCheck`, `DpdpCheckKey`, and `dpdpCheckSource(key: DpdpCheckKey): DpdpCheckSource`.
  - `interface DpdpCatalogItem { id: string; group: DpdpGroup; citation: string; owner: DpdpOwner; penaltyTier: DpdpPenaltyTier; planItems: string[]; baseline: Exclude<DpdpItemStatus,'unverified'>; checks: DpdpCheckKey[]; conditional?: true }`, `DPDP_CATALOG: readonly DpdpCatalogItem[]`, `DPDP_CODE_CHECK_RESULTS: Record<DpdpCodeCheck, 'pass'|'fail'>`.
  - `dpdpAttestInputSchema` (Zod; section Global Constraints) and `type DpdpAttestInput`.
  - Response types `DpdpCheckView { key; source; result; detail: string; params?: Record<string,string|number|boolean>; attestation?: DpdpAttestationView }`, `DpdpAttestationView { result: 'pass'|'fail'; note; evidenceUrl: string|null; byName: string; at: string; expiresAt: string }`, `DpdpItemView { id; group; citation; owner; penaltyTier; planItems; status: DpdpItemStatus; conditional: boolean; checks: DpdpCheckView[] }`, `DpdpMilestone { id; date: string; daysLeft: number; passed: boolean }`, `DpdpRegisterResponse { generatedAt: string; milestones: DpdpMilestone[]; summary: { total; following; partial; notFollowing; unverified; byTier: Record<DpdpPenaltyTier, { notFollowing; partial; unverified }> }; groups: { id: DpdpGroup; items: DpdpItemView[] }[] }`, `DpdpHistoryResponse { data: DpdpAttestationView[] }`.

**Code checks** (each is a known gap today, result `fail`; the PR that ships the fix flips it): `pii.column_encryption` (r27), `rls.privileged_guc_fixed` (r28), `logs.erasure_keeps_year` (r25, r31), `ci.security_jobs_scheduled` (r33), `ai.workspace_switch` (r35), `transfer.country_killswitch` (r42), `dpa.acceptance_persisted` (r32), `consent.lawful_basis_dpdp` (r01).

**Checks per item** (all other items have none and use `baseline`): r01 `consent.default_opt_in`, `consent.lawful_basis_dpdp`; r25 `logs.audit_retention`, `logs.session_retention`, `logs.erasure_keeps_year`; r26 `lifecycle.enabled`; r27 `redis.auth`, `crypto.rotation_complete`, `storage.encrypted_at_rest`, `pii.column_encryption`; r28 `mfa.operators`, `mfa.workspace_admins`, `rls.privileged_guc_fixed`; r30 `backup.offsite_configured`, `backup.restore_drill`; r31 `logs.audit_retention`, `logs.session_retention`, `logs.erasure_keeps_year`; r32 `legal.vendor_dpas`, `dpa.acceptance_persisted`; r33 `security.pentest_report`, `ci.security_jobs_scheduled`; r35 `ai.platform_key_off`, `ai.workspace_switch`; r42 `hosting.region_documented`, `errors.vendor_region`, `transfer.country_killswitch`; r43 `legal.vendor_dpas`; r45 `legal.counsel_engaged`; r47 `governance.contacts_named`.

**Catalog rules:** `id` is `r01`..`r47` equal to the row number in section 3 of the plan doc; `group`, `citation`, `owner` (T=tenant, P=platform, B=both), `baseline` (FOLLOWING, PARTIAL, NOT FOLLOWING, N/A) and `planItems` (the Build column) are copied from that row. `penaltyTier`: rows 27 to 35 `'250'`; 36 to 38 and 39 to 41 `'200'`; 44 `'150'`; every other row `'50'`. Row 44 has `conditional: true`.

- [ ] **Step 1: Write the failing test** in `catalog.spec.ts` with `it` names and assertions:
  - `has 47 unique ids r01..r47` : `DPDP_CATALOG.map(i=>i.id)` equals `Array.from({length:47},(_,n)=>'r'+String(n+1).padStart(2,'0'))`.
  - `baseline totals match the plan` : counts of `baseline` are `{following:1, partial:26, not_following:20, not_applicable:0}`.
  - `every check key is known and every code check has a result` : each `checks` entry is in the union of the three lists; `DPDP_CODE_CHECKS` equals `Object.keys(DPDP_CODE_CHECK_RESULTS)`.
  - `every plan item id exists in the plan doc` : read `docs/privacy/dpdpa-gap-analysis-and-plan.md`, assert each `planItems` id appears as `| DP-nn` in it.
  - `attest schema` : rejects note of 9 characters, `expiresInDays` 0 and 366, a non-https `evidenceUrl`; defaults `expiresInDays` to 90.
- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @crm/api exec vitest run test/unit/dpdp-register/catalog.spec.ts` Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the files above. Types in `status.ts`/`checks.ts`; the 47 entries in `catalog.ts` transcribed from the plan doc table; schemas in `register.ts`.
- [ ] **Step 4: Run to verify it passes** (same command), then `pnpm --filter @crm/contracts typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add packages/contracts/src/dpdp-register packages/contracts/src/index.ts docs/specs/dpdp-compliance-register.md apps/api/test/unit/dpdp-register/catalog.spec.ts && git commit -m "feat(contracts): add the DPDP register catalog and contract"`.

---

### Task 2: Attestation table

**Files:**

- Create: `packages/db/migrations/20261216090000_dpdp_register_attestations.sql`
- Modify: `tools/tenancy-audit/policy/table-classification.json` (add `dpdp_register_attestations`: class `PLATFORM_ONLY`, reason `privileged-only policy, append-only compliance attestations, no tenant data`, reviewed `2026-10-17`); `docs/specs/dpdp-compliance-register.md` section 5 (`attested_by bigint not null references platform_operators(id)`, replacing `uuid`)

**Interfaces:**

- Produces: table `dpdp_register_attestations(id uuid pk default gen_random_uuid(), check_key text not null, result text not null check (result in ('pass','fail')), note text not null check (length(note) >= 10), evidence_url text, attested_by bigint not null references platform_operators(id), attested_at timestamptz not null default now(), expires_at timestamptz not null)` and index `(check_key, attested_at desc)`.

- [ ] **Step 1: Invoke the `add-migration` skill** and follow it for file naming and checks.
- [ ] **Step 2: Write the migration:** create the table and index; `ENABLE` and `FORCE` row level security; `CREATE POLICY platform_only ... FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged())`; `REVOKE UPDATE, DELETE ON dpdp_register_attestations FROM crm_app, crm_worker`; function `dpdp_register_attestations_guard()` raising `restrict_violation` for any `UPDATE` or `DELETE`, plus a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger (pattern of `20261211090000_audit_log_append_only.sql`, but with no privileged exception); `COMMENT ON TABLE` stating it is append-only and holds no personal data beyond the operator id.
- [ ] **Step 3: Apply and verify.** Run `pnpm db:migrate && pnpm db:status && pnpm db:verify-schema && bash .claude/skills/add-migration/scripts/check-rls.sh dpdp_register_attestations`. Expected: migration applied, verify-schema clean, RLS check passes.
- [ ] **Step 4: Verify append-only and the tenancy audit.** Insert one row with psql as the owner, then `UPDATE dpdp_register_attestations SET note='x'` and `DELETE`; both must fail with `append-only`. Run `pnpm audit:tenancy`. Expected: refusal messages, audit GO.
- [ ] **Step 5: Fix the spec** (`bigint`) and commit `git add packages/db/migrations/20261216090000_dpdp_register_attestations.sql tools/tenancy-audit/policy/table-classification.json docs/specs/dpdp-compliance-register.md && git commit -m "feat(db): add the append-only DPDP register attestation table"`.

---

### Task 3: Pure rules

**Files:**

- Create: `apps/api/src/modules/dpdp-register/rules.ts`
- Test: `apps/api/test/unit/dpdp-register/rules.spec.ts`

**Interfaces:**

- Consumes: Task 1 types and `DPDP_CATALOG`, `DPDP_CODE_CHECK_RESULTS`, `dpdpCheckSource`.
- Produces:
  - `interface ProbeOutcome { result: DpdpCheckResult; detail: string; params?: Record<string, string|number|boolean> }`
  - `interface AttestationRecord { checkKey: DpdpAttestableCheck; result: 'pass'|'fail'; note: string; evidenceUrl: string|null; byName: string; attestedAt: Date; expiresAt: Date }`
  - `resolveItemStatus(item: DpdpCatalogItem, checks: DpdpCheckView[]): DpdpItemStatus`
  - `evaluate(input: { catalog: readonly DpdpCatalogItem[]; probes: Partial<Record<DpdpLiveCheck, ProbeOutcome>>; attestations: AttestationRecord[]; now: Date }): DpdpRegisterResponse`
  - `MILESTONES: readonly { id: 'consent_managers'|'main_duties'; date: string }[]` with dates `2026-11-14` and `2027-05-14`.

- [ ] **Step 1: Write the failing tests** (table-driven where marked):
  - `resolveItemStatus` table: (P,F,U) = (2,0,0) `following`; (1,0,1) `unverified`; (0,0,2) `unverified`; (1,1,0) `partial`; (0,1,1) `partial`; (0,2,0) `not_following`; no checks takes `baseline` (use r20 `following`, r44 `not_following`).
  - `an attested pass counts only until it expires` : expiry exactly at `now` gives `unknown` with detail `attestation_expired`; one millisecond later also `unknown`; one millisecond before gives `pass`.
  - `the newest attestation wins` : two records for one key, the later `attestedAt` decides.
  - `a missing live probe is unknown, not pass` : empty `probes` makes every live check `unknown` with detail `probe_missing`.
  - `code checks always carry their declared result and the source code`.
  - `summary counts` : total 47, counts add up, `not_applicable` excluded from `total`, `byTier` sums match for tier `'250'`.
  - `milestones` : `now` after 2027-05-14 gives `daysLeft` 0 and `passed` true; a date 10 days away gives `daysLeft` 10 and `passed` false.
- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @crm/api exec vitest run test/unit/dpdp-register/rules.spec.ts` Expected: FAIL.
- [ ] **Step 3: Implement** `rules.ts` per the signatures; groups follow the catalog order A to I, items ordered not_following, partial, unverified, following, not_applicable within a group (stable, then by id).
- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/api/src/modules/dpdp-register/rules.ts apps/api/test/unit/dpdp-register/rules.spec.ts && git commit -m "feat(api): add the DPDP register rules"`.

---

### Task 4: Live probes

**Files:**

- Create: `apps/api/src/modules/dpdp-register/probes.ts`
- Modify: `apps/api/src/modules/auth/maintenance/auth-maintenance.service.ts` (replace the two `interval '90 days'` session purges with `make_interval(days => ${ENDED_SESSION_RETENTION_DAYS})` and export `const ENDED_SESSION_RETENTION_DAYS = 90`); `apps/api/src/modules/auth/index.ts` (export it); `apps/api/src/modules/platform-infrastructure/index.ts` (export `sentryEnabled`)
- Test: `apps/api/test/unit/dpdp-register/probes.spec.ts`

**Interfaces:**

- Consumes: `ProbeOutcome` (Task 3), `SecurityPolicy` from `@crm/contracts`.
- Produces:
  - `interface ProbeDeps { policy(): Promise<SecurityPolicy>; env(key: string): string | undefined; platformKeyProviders(): Promise<string[]>; consentAdoption(): Promise<{ on: number; total: number }>; sentryEnabled(): boolean; sessionRetentionDays: number }`
  - `runProbes(deps: ProbeDeps): Promise<Record<DpdpLiveCheck, ProbeOutcome>>`
  - `redisUrlHasAuth(url: string): boolean` (true for `rediss:` or a URL with a password)
  - `sentryDsnRegion(dsn: string): 'us' | 'de' | 'in' | 'other'` (host `*.ingest.us.sentry.io` is `us`, `.de.` is `de`, `.in.` is `in`, anything else `other`)

- [ ] **Step 1: Write the failing tests:**
  - `redisUrlHasAuth` : `redis://redis:6379` false; `redis://:s3cret@redis:6379` true; `rediss://redis:6379` true.
  - `sentryDsnRegion` : the DSN with host `o4507446172188672.ingest.us.sentry.io` is `us`; a host `sentry.example.com` is `other`.
  - `mfa.operators` passes only when `requireMfaForSuperAdmins` is true; `mfa.workspace_admins` only when `requireMfaForAdmins` is true.
  - `logs.audit_retention` : 0 pass, 365 pass, 364 fail, 1 fail. `logs.session_retention` : 90 fail, 365 pass.
  - `crypto.rotation_complete` : pass when `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` is unset or blank, fail otherwise.
  - `lifecycle.enabled` : pass only when enabled true, dry run false, delete enabled true (env strings `true`/`false`).
  - `errors.vendor_region` : Sentry off pass; on with a `us` DSN fail; on with an `other` host unknown; on with an `in` host pass.
  - `ai.platform_key_off` : empty provider list pass, one provider fail with `params.providers`.
  - `consent.default_opt_in` : default from `contactConsentSettingsSchema.parse({}).requireConsentForMarketing` false gives fail, with adoption `{on, total}` in params.
  - `a throwing dependency` : each probe whose dependency rejects returns `{ result: 'unknown', detail: 'probe_error' }` and the others still resolve.
- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @crm/api exec vitest run test/unit/dpdp-register/probes.spec.ts` Expected: FAIL.
- [ ] **Step 3: Implement** `probes.ts` (each probe wrapped in a helper that converts a throw into the `probe_error` outcome) and the three small edits listed under Files. Find the contact-consent settings schema name in `packages/contracts/src/contact-consent/settings.ts`.
- [ ] **Step 4: Run to verify it passes**, then the existing auth tests for the retention edit: `pnpm --filter @crm/api exec vitest run test/unit/dpdp-register test/unit/auth`. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/api/src/modules/dpdp-register/probes.ts apps/api/src/modules/auth apps/api/src/modules/platform-infrastructure/index.ts apps/api/test/unit/dpdp-register/probes.spec.ts && git commit -m "feat(api): add the DPDP register live probes"`.

---

### Task 5: Service, controller, module and e2e

**Files:**

- Create: `apps/api/src/modules/dpdp-register/dpdp-register.service.ts`, `dpdp-register.controller.ts`, `dpdp-register.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts` (import and register `DpdpRegisterModule` next to `ComplianceCenterModule`, line 255)
- Test: `apps/api/test/e2e/dpdp-register/dpdp-register.e2e.spec.ts` (model on `test/e2e/lead-scoring/lead-scoring.e2e.spec.ts`: `startHarness`, `OPERATOR_EMAIL`/`OPERATOR_PASSWORD`, supertest against `/v2/platform`)

**Interfaces:**

- Consumes: Tasks 1, 3, 4; `PlatformStore.tx`, `SecurityPolicyService`, `AuthAuditService`, `AiKeyResolver`, `ConfigService<Env, true>` with `{ infer: true }`.
- Produces: `DpdpRegisterService` with `get(): Promise<DpdpRegisterResponse>`, `history(key: string): Promise<DpdpHistoryResponse>`, `attest(key: string, input: DpdpAttestInput): Promise<DpdpRegisterResponse>`. Routes: `GET /v2/platform/dpdp-register`, `GET /v2/platform/dpdp-register/checks/:key/history`, `POST /v2/platform/dpdp-register/checks/:key/attest`.

- [ ] **Step 1: Write the failing e2e tests** (names and assertions):
  - `GET returns 47 items in groups A to I with the summary adding up` : `summary.total` 47 minus not applicable, and the sum of the four status counts equals it.
  - `auditor and support can read, only super_admin can attest` : POST as support and as auditor returns 403; as super admin 200.
  - `no token and a tenant user are refused` : 401 and 403.
  - `attest then read shows the newest result` : attest `hosting.region_documented` pass with a 12-character note; GET shows that check `pass` with `source` `attested` and `attestation.byName`; a second attest `fail` then shows `fail`.
  - `an unknown key and a short note return 422 and write nothing` : count of rows unchanged; `GET .../checks/not.a.key/history` also returns 422.
  - `history lists newest first with who and when`.
  - `an attestation writes a security_events row` : event `dpdp_register.attested`, actor type `platform_operator`.
  - `the table refuses UPDATE and DELETE` : raw SQL through the owner connection raises `append-only`.
  - `a probe failure does not fail the page` : stub the policy service to throw once; GET still 200 with the affected checks `unknown`.
- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @crm/api test:e2e -- dpdp-register` Expected: FAIL, 404.
- [ ] **Step 3: Implement** the service (`get()` builds `ProbeDeps` from the injected services, loads attestations through `PlatformStore.tx` joining `platform_operators.full_name`, calls `evaluate`; `attest()` validates the key against `DPDP_ATTESTABLE_CHECKS`, inserts the row with `RequestContextStore.require().actorId`, records the audit event in the same transaction, returns `get()`). Controller: `@ApiTags('platform') @ActorKinds('platform_operator') @UseGuards(OperatorGuard)`; GET routes list all three roles in `@OperatorRoles(...)` (check its signature in `modules/auth/guards/auth-gates.ts`); POST `@OperatorRoles('super_admin')`; body through `zodPipe(dpdpAttestInputSchema)`. Use the repo's validation `AppError` for the 422.
- [ ] **Step 4: Run to verify it passes**, then `pnpm audit:authz && pnpm audit:tenancy && pnpm --filter @crm/api test` (includes the route-permission coverage and OpenAPI tests). Expected: PASS and GO.
- [ ] **Step 5: Commit** `git add apps/api/src/modules/dpdp-register apps/api/src/app.module.ts apps/api/test/e2e/dpdp-register && git commit -m "feat(api): add the DPDP register endpoints"`.

---

### Task 6: Operator page

**Files:**

- Create under `apps/web/src/features/dpdp-register/platform/`: `queries.ts`, `logic.ts`, `logic.test.ts`, `operator-nav.ts`, `dpdp-register-page.tsx`, `summary-strip.tsx`, `register-list.tsx`, `attest-dialog.tsx`, `history-list.tsx` (the attestations of one check, opened from the row's History link), `dpdp-register-page.test.tsx`; and `apps/web/src/app/(admin)/(dpdp-register)/admin/dpdp-register/page.tsx`
- Modify: `apps/web/src/features/auth-registration-security/platform/operator-nav.ts` (import `DPDP_OPERATOR_NAV`, spread it near line 143); `apps/web/src/features/admin-console-shell/console-layout.ts` (insert `'dpdp-register'` after `'security-events'` in the `team` hub); `apps/web/src/features/admin-console-shell/console-keywords.ts` (add `'dpdp-register': 'dpdp data protection act privacy compliance india rules consent breach grievance checklist register'`)
- Create: `apps/web/messages/en/dpdp-register-admin.json`

**Interfaces:**

- Consumes: Task 1 response types; `operatorFetch` and `useOperator` (see `lead-scoring/platform/lead-scoring-page.tsx`).
- Produces: `DPDP_OPERATOR_NAV` (id `dpdp-register`, href `/admin/dpdp-register`); `REGISTER_KEY = ['operator','dpdp-register']`; `registerSchema` typed `Out<DpdpRegisterResponse>`; in `logic.ts`: `type StatusFilter = 'all'|DpdpItemStatus`, `filterGroups(groups, filter): DpdpRegisterResponse['groups']`, `statusTone(s: DpdpItemStatus): 'good'|'warn'|'bad'|'neutral'`.

- [ ] **Step 1: Write the failing tests.**
  - `logic.test.ts`: `filterGroups` with `not_following` keeps only those items and drops empty groups; `all` returns everything; `statusTone('following')` is `good`, `'partial'` `warn`, `'not_following'` `bad`, `'unverified'` and `'not_applicable'` `neutral`.
  - `dpdp-register-page.test.tsx` (pattern of `lead-scoring-page.test.tsx`, real English messages): renders the disclaimer text; shows counts from a mocked payload; default order shows a `not_following` row before a `following` row; clicking the "Not following" chip hides the others; the Attest button is present for `super_admin` and absent for `auditor`; the dialog blocks submit while the note is under 10 characters; the History link loads `/checks/<key>/history` and lists who attested and when.
  - Existing `console-layout.test.ts` must still pass (placement and reachability).
- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @crm/web exec vitest run src/features/dpdp-register` Expected: FAIL.
- [ ] **Step 3: Implement** the files. Row content per spec section 7: status chip with text, `rNN`, citation, title key `items.rNN.title`, owner, the checks list (mark, source tag, detail text from `checks.<key>.<detail>` keys), plan item ids. The summary strip shows the five counts, a stacked bar, days to each milestone and the penalty-tier strip. Texts come from `dpdp-register-admin` keys only; add the English file with keys: `nav.group`, `nav.register`, `page.*`, `summary.*`, `status.*`, `source.*`, `filters.*`, `groups.A..I`, `owners.*`, `tiers.*`, `items.r01..r47.title`, `checks.<key>.title` and `.details.<detail>`, `attest.*`, `history.*`, `errors.*`. Item titles are the "Requirement" column of the plan table shortened to under 12 words.
- [ ] **Step 4: Run to verify it passes**, then `pnpm --filter @crm/web test && pnpm --filter @crm/web typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/web/src/features/dpdp-register "apps/web/src/app/(admin)/(dpdp-register)" apps/web/src/features/auth-registration-security/platform/operator-nav.ts apps/web/src/features/admin-console-shell apps/web/messages/en/dpdp-register-admin.json && git commit -m "feat(web): add the DPDP register page to the operator console"`.

---

### Task 7: Translations

**Files:**

- Create: `apps/web/messages/<locale>/dpdp-register-admin.json` for the other 20 locales (`apps/web/scripts/.locales.json`)

- [ ] **Step 1: Invoke the `i18n-translate-sync` skill** and follow it: `node scripts/i18n-audit.mjs gaps`, `node scripts/i18n-tool.mjs plan 3000`.
- [ ] **Step 2: Translate** every key into each locale (keep ICU arguments and tags; keep "DPDP", Act section and rule citations, "Rs" and "crore" as written; `ar`, `he`, `ur` text only).
- [ ] **Step 3: Apply and validate.** `node scripts/i18n-tool.mjs apply <locale> /tmp/i18n/out/<locale>.json` for each, then `node scripts/i18n-tool.mjs check`. Expected: no drift reported.
- [ ] **Step 4: Prove it.** `bash .claude/skills/i18n-translate-sync/scripts/check.sh` and `pnpm --filter @crm/web test`. Expected: PASS, including the messages test.
- [ ] **Step 5: Commit** `git add apps/web/messages && git commit -m "feat(web): translate the DPDP register into all locales"`.

---

### Task 8: Docs, gates and sign-off

**Files:**

- Create: `docs/threadwise-port/wiring/dpdp-register.md` (route, roles, table, settings none, probes, upstream services, files; model on `docs/threadwise-port/wiring/compliance-center.md`)
- Modify: `docs/threadwise-port/parity/product-extensions.md` (add an entry for the register); `docs/privacy/dpdpa-gap-analysis-and-plan.md` (one sentence in section 3 intro: the platform register at `/admin/dpdp-register` mirrors these rows)

- [ ] **Step 1: Write the wiring file and the two doc edits;** run `npx prettier@3 --write` on them.
- [ ] **Step 2: Parity.** The owner approved skipping on 17 Oct 2026. Run `python .claude/skills/threadwise-playwright-parity/scripts/stamp.py write --status skipped --user-approved "Owner approved on 2026-10-17: no Reference twin for the DPDP register"` (confirm the script path and arguments in that skill first).
- [ ] **Step 3: Security gate.** Invoke the `security-review-gate` skill; triage and fix every confirmed finding, reading the cited code before acting.
- [ ] **Step 4: Full gate.** `bash .claude/skills/pre-pr/scripts/gate.sh`. Expected: all checks pass.
- [ ] **Step 5: Verify live.** Start the dev stack, sign in as a super admin, open `/admin/dpdp-register`, and check: counts add up, the Redis row shows `redis.auth` fail, Attest on `hosting.region_documented` flips that check, and `auditor` has no Attest button.
- [ ] **Step 6: Commit** `git add docs && git commit -m "docs(docs): wire the DPDP register and record the parity skip"`. Open a PR only when the owner asks.
