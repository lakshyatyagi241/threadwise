# Parity evidence: BSP reseller billing engine

WaDesk 1.7.0 vs the `bsp` worktree. Backend evidence is automated: `apps/api/test/e2e/bsp-billing-engine/` (69 scenarios through HTTP against
real Postgres and a stand-in Graph API), `test/integration/bsp-billing-engine/allocations-schema.spec.ts` (RLS and constraints),
`test/unit/bsp-billing-engine/` (39). Web: `apps/web/src/features/bsp-billing-engine/*.test.ts(x)` (17).

## Intended differences from WaDesk

| #   | Area                      | WaDesk                                          | Here                                                                                         | Why                                           |
| --- | ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Admin identity            | Any workspace user with the admin flag          | Platform operator pool; writes need `super_admin`                                            | Separate identity pool in this platform       |
| 2   | Status probe (WD-BSP-001) | `enabled` flag that nothing sets, schema probes | `ok`, `module`, `configured`, `graphVersion`, `allocations`                                  | Inventory port note; the schema always exists |
| 3   | Reseller flag             | `bill_to_platform_credit` flipped without audit | Same column; the flip is audited and emits an outbox event                                   | Inventory port note (WD-BSP-011)              |
| 4   | Revoke                    | Does not look at the workspace billing mode     | Response lists workspaces still in reseller mode                                             | Makes the double-billing QUIRK visible        |
| 5   | Attach all                | One long synchronous loop                       | Bounded batches with limited concurrency; reports what remains                               | A Graph call can take 30 s                    |
| 6   | Auto-attach (WD-BSP-008)  | Fired on a WABA-saved event                     | Sweep job over connected WABAs of reseller workspaces                                        | Connection module and event not built yet     |
| 7   | Token                     | Stored in a settings row                        | Encrypted envelope in platform settings; never returned                                      | Secrets rule                                  |
| 8   | Dashboard month           | Current month only                              | API accepts `month=YYYY-MM`; the screen shows the current month only, as WaDesk does         | Port note allows the API parameter            |
| 9   | Customer billing card     | Lives on the WhatsApp devices screen            | Removed from the workspace side (commit 6ad39bd0); the mode is set by the operator and through the API | Messages are billed from the wallet and subscription |

## Blocked or not ported (recorded, not dropped)

| Id                        | State      | Reason                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-BSP-012                | done       | Settle, refund and precheck run in the WALLET module (`wallet-message-billing`: `message-billing.service.ts`, `wallet-gate.service.ts`) and consume `BillingModeService` from this barrel; covered by `test/e2e/wallet-message-billing/engine.e2e.spec.ts` (reseller vs direct mode, idempotent charge, refund, empty-wallet free row) |
| WD-BSP-013                | blocked    | The admin workspace form (create/edit with the reseller flag) is the workspace admin domain's screen; the wallet admin workspace detail already shows and sets the mode                                                                                                                                                                |
| WD-BSP-017                | done       | `ratesEndpoint` and the token are this domain's settings; sync/import live in WALLET (`platform-rates.service.ts` `syncMeta` reads the BSP `connection.ratesEndpoint`; live fetch falls back to the bundled card)                                                                                                                      |
| WD-BSP-002                | done       | Billing menu entries, "Message pricing" link on the credit page, "Rates & margin" link on the P&L page, and `/admin/bsp/rate-cards` redirects to `/admin/wallet/pricing`                                                                                                                                                               |
| WD-BSP-018, 019, 020, 021 | not ported | Docs-only or dead code in WaDesk (no behaviour to port)                                                                                                                                                                                                                                                                                |

## Screens

Round 5 conformance pass against the WaDesk Blade views `bsp/credit/index.blade.php` and `bsp/dashboard/index.blade.php` (read line by line; the live
pages were not opened, the Blade source is what renders them). Fixed: page eyebrow, heading and intro on both pages; the P&L header pills (P&L,
Rates & margin, Connect Meta) and the "Wallet rules" links; banner and table-heading copy; step titles, field labels, hints and placeholders of
step 1 and step 2, the "stored encrypted" note beside Save, the red "Locked once attached" box, register column "Alloc ID" and lowercase
status words, revoke confirmation, and the setup-guide copy with the Meta links.

Deliberate differences on these screens:

| Screen                       | WaDesk                                                                 | Here                                 | Why                                                                           |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Credit, step 2 currency list | Every row of the `currencies` table (most are rejected by Meta, QUIRK) | Only the six currencies Meta accepts | Fixes the QUIRK in WD-BSP-003 rule 3                                          |
| Credit, step 1               | No base-currency field                                                 | Extra "Base currency" field          | Needed for the income figures (`bsp_base_currency`, WD-BSP-006 settings note) |
| Credit, Graph version        | Placeholder says v25.0, code default v26.0                             | v26.0 in both                        | WaDesk's own inconsistency; behaviour (v26.0) kept                            |
| Credit, attach confirm       | Browser `confirm()`                                                    | `ConfirmDialog`                      | @crm/ui pattern                                                               |
| Both                         | Serif display headings with an italic accent word                      | Platform page header                 | Platform design system                                                        |

## Not ported on purpose

WD-BSP-018 (markup configuration, docs only), WD-BSP-019 (dedicated BSP wallet, top-up packages, usage events, rate-card tables: tables exist in
WaDesk migrations but no route, model use or screen), WD-BSP-020 (aggregator and partner credit sources, docs only; `bsp_credit_source` is never
written), WD-BSP-021 (three-step share and revoke-by-discovery, docs only; the code performs only the single attach and DELETE already built in
WD-BSP-006 and 009). The inventory feature index marks all four docs-only or dead-code.

WD-BSP-013 stays blocked: the admin workspace create/edit form does not exist in this repo (no `admin/workspaces` controller in
`apps/api/src/modules`, no `(admin)/.../workspaces` create or edit page under `apps/web/src/app`; the nearest screens are the wallet admin
workspace list and detail). The toggle will be one additive edit once the workspace admin domain ships that form: a `billingMode` field wired through
`BillingModeService` from this module's barrel. Until then the wallet admin detail sets the mode and audits it.

Tier P0 done: WD-BSP-003, 004, 005, 006, 011, 012, 014, 016. Tier P1 done: WD-BSP-007, 008, 009, 010, 015, 017. Tier P2 done: WD-BSP-001, 002. WD-BSP-013 stays blocked on the workspace admin form.
Round-3 note: the web unit tests (17) pass; the API e2e and integration suites were not re-run because the local Postgres was not reachable (docker daemon down).
Round-4 verification (Postgres up, crm_bsp migrated, 178 migrations): API unit 39, BSP plus wallet-message-billing e2e 156 (6 files), integration 9, web 17 all pass; arch:check and db:verify-schema clean (0 errors). Remaining typecheck errors (8 in api specs, 1 in web plan-draft.test.ts) are in other domains' files. Screens were still not compared side by side with the running WaDesk.

Round-5: tier P0/P1/P2 unchanged; screens conformed to the Blade source (see Screens); 013 re-checked and still blocked; 018 to 021 listed under "Not ported on purpose".

Round-6: the two Help guides (`bsp-credit`, `bsp-dashboard`, operator audience) are written under `features/bsp-billing-engine/help/`. The e2e harness no longer assumes the platform policy forces super-admin MFA enrolment (it enrols only when the login says so). Re-run on crm_bsp (277 migrations): API unit 39, BSP + wallet-message-billing e2e 182 (7 files), web 18 files in help-center + bsp (only other domains' coverage gates fail). WD-BSP-013 re-checked on the merged tree: the operator Workspaces hub (`features/workspaces-hub`, `/admin/workspaces`) has only list, detail, plan, provider, suspend and impersonate dialogs, no create/edit form; the toggle would go in a new dialog in `apps/web/src/features/workspaces-hub/components/` plus a workspaces-hub API endpoint, both another domain's zone, so it stays blocked. WD-BSP-018 to 021 remain "not ported on purpose". Live side-by-side with the running WaDesk was not repeated this round.

Round-7 (verifier): live WaDesk compared on `/admin/bsp/credit`, `/admin/bsp` and `/admin/bsp/rate-cards`. Fixed: required asterisks on Business ID and token, rates endpoint placeholder, per-workspace table keeps its column headings when empty. Money still prints with the currency symbol (WaDesk prints bare numbers).
