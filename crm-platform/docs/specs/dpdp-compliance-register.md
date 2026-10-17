# DPDP compliance register (super admin console)

Status: **design approved by the owner on 17 Oct 2026; this spec awaits owner review.** Nothing is built.
Parent: [privacy/dpdpa-gap-analysis-and-plan.md](../privacy/dpdpa-gap-analysis-and-plan.md) (section 3 is the source of the catalog). This is
slice 1 of the plan; later slices flip rows of this register as they ship.

## 1. Goal

Give platform operators one page that always shows which DPDP Act 2023 and DPDP Rules 2025 obligations the platform follows today and
which it does not, with the evidence for each, so progress toward the commencement dates is visible and nothing is claimed without proof.

Non-goals (all later slices or out of scope): changing any security default or behaviour; a tenant-facing register (the workspace
Compliance center stays as it is); push alerts; PDF export; any statement that the platform "is compliant".

## 2. Users and access

| Operator role | Can do                                                 |
| ------------- | ------------------------------------------------------ |
| `super_admin` | read the register, read history, record an attestation |
| `support`     | read the register and history                          |
| `auditor`     | read the register and history                          |

No new platform permission key. Access uses `@ActorKinds('platform_operator')`, `@UseGuards(OperatorGuard)` and `@OperatorRoles(...)`, as
the lead-scoring platform page does.

## 3. The catalog

A code-defined list of the 47 obligations in section 3 of the plan, in `packages/contracts/src/dpdp-register/catalog.ts`. One entry per row:

| Field         | Meaning                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `r01` to `r47`, equal to the row number in the plan. Stable, never reused.                                                   |
| `group`       | `A` to `I`, as in the plan (grounds and consent; rights; retention; security; breach; children; transfers; SDF; governance). |
| `citation`    | The Act section or rule, for example `s8(5), rule 6(1)(a)`.                                                                  |
| `owner`       | `tenant`, `platform` or `both`, as the plan's Owner column.                                                                  |
| `penaltyTier` | `250`, `200`, `150`, `50` (crore rupees) or `none`, from the Schedule row the provision falls under.                         |
| `planItems`   | The `DP-nn` ids that close the gap.                                                                                          |
| `baseline`    | Declared status when no check decides it: `following`, `partial`, `not_following` or `not_applicable`.                       |
| `checks`      | Zero or more check keys (section 4) that decide the status.                                                                  |
| `conditional` | True for row 44 (Significant Data Fiduciary): shown, counted, and marked "only if notified".                                 |

A unit test pins the catalog: 47 unique ids, every `planItems` id exists in the plan, and the **baseline-only** totals equal the plan's
counts (1 following, 26 partial, 20 not following). Changing a baseline therefore needs a deliberate edit in the PR that ships the feature.

## 4. Status model

Statuses: `following`, `partial`, `not_following`, `not_applicable`, `unverified`.

A **check** is one yes/no fact with a result `pass`, `fail` or `unknown` and a source:

- `live`: read by the API at request time from configuration or the database. A probe that throws returns `unknown` with detail
  `probe_error`; it never returns `pass`.
- `attested`: a super admin recorded a result with a note. The newest attestation for the key counts while it has not expired; an expired
  or missing one is `unknown`.
- `code`: a fixed result declared in the catalog for something the running code cannot show (for example, "no breach register exists").
  The PR that ships the feature changes it.

An item with checks resolves like this, with P passes, F fails and U unknowns:

| Condition                  | Item status     |
| -------------------------- | --------------- |
| F = 0 and U = 0            | `following`     |
| F = 0 and U > 0            | `unverified`    |
| F > 0 and (P > 0 or U > 0) | `partial`       |
| F > 0 and P = 0 and U = 0  | `not_following` |

An item with no checks takes its `baseline`. `not_applicable` items are listed but excluded from the counts. A row is never
`following` unless every check passed.

### 4.1 Initial live probes

| Check key                  | Reads                                                                                           | Passes when                                    | Rows     |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------- |
| `mfa.operators`            | `SecurityPolicyService.policy()`: `requireMfaForSuperAdmins`                                    | true                                           | r28      |
| `mfa.workspace_admins`     | same policy: `requireMfaForAdmins`                                                              | true                                           | r28      |
| `logs.audit_retention`     | policy `auditLogRetentionDays`                                                                  | 0 (never prune) or at least 365                | r25, r31 |
| `logs.session_retention`   | the ended-session purge constant in `auth-maintenance.service.ts`, exported as a named constant | at least 365 days                              | r25, r31 |
| `redis.auth`               | `REDIS_URL` through `ConfigService`                                                             | URL carries a password or uses `rediss:`       | r27      |
| `crypto.rotation_complete` | `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS`                                                          | empty                                          | r27      |
| `lifecycle.enabled`        | `ORG_LIFECYCLE_ENABLED`, `ORG_LIFECYCLE_DRY_RUN`, `ORG_LIFECYCLE_DELETE_ENABLED`                | enabled, not dry run, delete enabled           | r26      |
| `errors.vendor_region`     | `sentryEnabled()` and the DSN host                                                              | Sentry off, or the DSN host in an India region | r42      |
| `ai.platform_key_off`      | AI key resolver: is a platform key configured for any provider                                  | no platform key configured                     | r35      |
| `consent.default_opt_in`   | privileged aggregate of `contact_consent_settings` plus the contract default                    | contract default for new workspaces is opt-in  | r01      |

Each probe also returns a short `detail` key and params (for example the current retention days) so the row can say why. Probes that
need a privileged read go through the platform store, not through a request-scoped tenant context.

### 4.2 Attestable checks

Facts a program cannot read. A super admin records `pass` or `fail`, a note of at least 10 characters, an optional evidence URL and an
expiry (1 to 365 days, default 90).

| Check key                   | Fact                                                                        | Rows     |
| --------------------------- | --------------------------------------------------------------------------- | -------- |
| `hosting.region_documented` | Hosting provider, region and data locations are written down                | r42      |
| `storage.encrypted_at_rest` | Volume and object storage encryption evidence on file                       | r27      |
| `backup.offsite_configured` | Sealed off-site copy runs and covers object storage                         | r30      |
| `backup.restore_drill`      | A restore drill ran within the last 6 months                                | r30      |
| `security.pentest_report`   | An external penetration test report is on file, no open critical            | r33      |
| `legal.counsel_engaged`     | Indian data-protection counsel engaged                                      | r45      |
| `legal.vendor_dpas`         | Executed DPAs on file with the sub-processors that hold personal data       | r32, r43 |
| `governance.contacts_named` | Privacy contact, incident commander and grievance owner named and published | r47      |

The list is closed: an attestation for any other key is rejected with 422.

### 4.3 Code checks

Gaps the running code cannot show, so no probe can read them and no one can attest them. Each has a fixed result in the catalog
(`DPDP_CODE_CHECK_RESULTS`), and every one is `fail` today. The PR that ships the fix flips it to `pass`, in the same change.

| Check key                     | Gap it records (plan item that closes it)                                                     | Rows     |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| `pii.column_encryption`       | Contact phone, email and message body are not encrypted per column (DP-12b)                   | r27      |
| `rls.privileged_guc_fixed`    | `app.privileged` is still a settable database setting; the ADR-0028 fix is unfinished (DP-16) | r28      |
| `logs.erasure_keeps_year`     | Erasure and workspace erase delete history and logs at once, not after a year (DP-14, DP-51)  | r25, r31 |
| `ci.security_jobs_scheduled`  | CI security workflows are manual only; nothing runs them on a schedule (DP-16)                | r33      |
| `ai.workspace_switch`         | No workspace switch or notice for the AI paths that send contact text to a vendor (DP-74)     | r35      |
| `transfer.country_killswitch` | No per-vendor country tag and no way to cut off a country the Government restricts (DP-72)    | r42      |
| `dpa.acceptance_persisted`    | No record anywhere that a workspace accepted the DPA, with version and time (DP-91)           | r32      |
| `consent.lawful_basis_dpdp`   | The purpose registry still uses GDPR lawful bases, not the Act's consent and s7 uses (DP-32)  | r01      |

## 5. Persistence

One migration, `packages/db/migrations/20261216090000_dpdp_register_attestations.sql`:

```
dpdp_register_attestations(
  id uuid pk default gen_random_uuid(),
  check_key text not null,
  result text not null check (result in ('pass','fail')),
  note text not null check (length(note) >= 10),
  evidence_url text null,
  attested_by uuid not null references platform_operators(id),
  attested_at timestamptz not null default now(),
  expires_at timestamptz not null
)
```

No `org_id`. RLS enabled and forced, one `FOR ALL` policy `USING/WITH CHECK (app_is_privileged())`, as `org_lifecycle_log`. Append-only:
`REVOKE UPDATE, DELETE` for the app role plus the trigger pattern of `20261211090000_audit_log_append_only.sql`. Index on
`(check_key, attested_at desc)`. The table is added to `tools/tenancy-audit/policy/table-classification.json`, and the service file that
calls `.privileged(` to `privileged-allowlist.json`. Every attestation also writes a `security_events` row, `dpdp_register.attested`
(actor type `platform_operator`), in the same transaction through `AuthAuditService`. The table is the durable record, since
`security_events` is pruned by the audit retention window.

## 6. API

Module `apps/api/src/modules/dpdp-register/` (`module`, `controller`, `service`, pure `rules.ts`, `probes.ts`, `index.ts`), registered in
`app.module.ts`. Contract in `packages/contracts/src/dpdp-register/`. Every route has `@ApiTags('platform')` and `@ApiOperation`.

| Route                                                | Role          | Returns or does                                                                 |
| ---------------------------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `GET /v2/platform/dpdp-register`                     | all operators | `generatedAt`, milestones with days left, summary, groups with items and checks |
| `GET /v2/platform/dpdp-register/checks/:key/history` | all operators | the attestations for the key, newest first, with who and when                   |
| `POST /v2/platform/dpdp-register/checks/:key/attest` | `super_admin` | `{ result, note, evidenceUrl?, expiresInDays }`; appends a row and audits it    |

`rules.ts` is a pure function `evaluate(catalog, probeResults, attestations, now)`. `probes.ts` gathers facts. The service combines them,
so the rules are tested without a database. Milestones: 14 Nov 2026 (Consent Manager registration, rule 4) and 14 May 2027 (main
duties); the summary says "about", matching the plan. Summary also reports, per penalty tier, how many items are not following,
partial or unverified.

## 7. Web

- Route `apps/web/src/app/(admin)/(dpdp-register)/admin/dpdp-register/page.tsx`; feature code in
  `apps/web/src/features/dpdp-register/platform/` (`page`, `queries.ts`, `operator-nav.ts`); fetch through `operatorFetch`.
- Placed in the `team` hub of `console-layout.ts` (8 tabs today, limit 20) after Security Center; keywords added to
  `console-keywords.ts`.
- Top: the disclaimer line, a stacked bar and counts for the five statuses, days to each milestone, and the penalty-tier strip.
- Body: filter chips (All, Not following, Partial, Unverified, Following), default All, ordered not following, partial, unverified,
  following within each group A to I. Each row: status chip with text, `r` id, citation, title, owner, the checks as a list of
  pass, fail or unknown marks with their source tag and detail, plan item ids, and for `super_admin` an **Attest** action on attestable
  checks (dialog: result, note, evidence URL, expiry) and a History link.
- States: loading, error with retry, and an empty filter result. Keyboard operable, visible focus, no meaning carried by colour alone.
- Wording never says "compliant". Header: "Tracks what the platform does today against the DPDP Act and Rules. It is not a
  compliance certificate."

## 8. Texts and docs

- New `apps/web/messages/<locale>/dpdp-register-admin.json` in all 21 locales through the `i18n-translate-sync` skill. Item titles are
  keys; check detail text comes from a closed set of keys with params. Act and rule citations and "Rs ... crore" stay as written.
- No help guide (the operator console is outside the help center), no `pending.json` entry.
- Wiring file `docs/threadwise-port/wiring/dpdp-register.md` and an entry in `docs/threadwise-port/parity/product-extensions.md`. The
  parity run is recorded as skipped on the owner's word (17 Oct 2026): this feature has no Reference twin.

## 9. Tests and gates

- Unit: `rules.spec.ts` table-driven over the status table; catalog integrity; every probe with a failing dependency returns `unknown`.
- E2E: operator RBAC (auditor and support cannot attest, anonymous and tenant users get 401 or 403), attest then read shows the newest
  result, expiry flips a check to `unknown`, the table rejects UPDATE and DELETE, unknown check key returns 422, a
  `security_events` row exists.
- Web: console-layout placement and unreachable-page tests, page render with a mocked payload, and the messages test across locales.
- Commands: `pnpm --filter @crm/api test`, `pnpm test:integration`, `pnpm --filter @crm/api test:e2e`, `pnpm --filter @crm/web test`,
  `pnpm lint`, `pnpm typecheck`, `pnpm arch:check`, `pnpm audit:tenancy`, `pnpm audit:authz`, `pnpm audit:auth`, `pnpm db:migrate`,
  `pnpm db:verify-schema`, `check-rls.sh dpdp_register_attestations`, the i18n check, the `security-review-gate`, then
  `bash .claude/skills/pre-pr/scripts/gate.sh`.

## 10. Risks

- **Catalog drift.** A feature ships and nobody flips its baseline. Mitigation: the pinned-counts test fails on any silent change, and
  the plan's items name the rows they close; the PR template for DP items says to update the catalog.
- **Probe accuracy.** A probe reads configuration, not enforcement. Its detail text says what it read. Deployment facts stay
  attested, never inferred.
- **Translation volume.** About 47 titles plus detail keys in 20 more locales. Keep texts short; reuse detail keys.
- **Hub limit.** `team` hub has room; if it fills, the placement test forces a decision.
- **Stale attestations.** Expiry turns them back into `unknown` so a past "yes" cannot hide a change.
