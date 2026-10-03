# Parity evidence: BSP reseller billing engine

Reference 1.7.0 vs the `bsp` worktree. Backend evidence is automated: `apps/api/test/e2e/bsp-billing-engine/` (69 scenarios through HTTP against
real Postgres and a stand-in Graph API), `test/integration/bsp-billing-engine/allocations-schema.spec.ts` (RLS and constraints),
`test/unit/bsp-billing-engine/` (39). Web: `apps/web/src/features/bsp-billing-engine/*.test.ts(x)` (17).

## Intended differences from Reference

| #   | Area                      | Reference                                          | Here                                                                                         | Why                                           |
| --- | ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Admin identity            | Any workspace user with the admin flag          | Platform operator pool; writes need `super_admin`                                            | Separate identity pool in this platform       |
| 2   | Status probe (TW-BSP-001) | `enabled` flag that nothing sets, schema probes | `ok`, `module`, `configured`, `graphVersion`, `allocations`                                  | Inventory port note; the schema always exists |
| 3   | Reseller flag             | `bill_to_platform_credit` flipped without audit | Same column; the flip is audited and emits an outbox event                                   | Inventory port note (TW-BSP-011)              |
| 4   | Revoke                    | Does not look at the workspace billing mode     | Response lists workspaces still in reseller mode                                             | Makes the double-billing QUIRK visible        |
| 5   | Attach all                | One long synchronous loop                       | Bounded batches with limited concurrency; reports what remains                               | A Graph call can take 30 s                    |
| 6   | Auto-attach (TW-BSP-008)  | Fired on a WABA-saved event                     | Sweep job over connected WABAs of reseller workspaces                                        | Connection module and event not built yet     |
| 7   | Token                     | Stored in a settings row                        | Encrypted envelope in platform settings; never returned                                      | Secrets rule                                  |
| 8   | Dashboard month           | Current month only                              | API accepts `month=YYYY-MM`; the screen shows the current month only, as Reference does         | Port note allows the API parameter            |
| 9   | Customer billing card     | Lives on the WhatsApp devices screen            | Reusable `BillingModeCard` plus its own page `/billing-mode` until the devices screen exists | Devices screen belongs to WADEV, not built    |

## Blocked or not ported (recorded, not dropped)

| Id                        | State      | Reason                                                                                                                                                                |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-BSP-012                | done       | Settle, refund and precheck run in the WALLET module (`wallet-message-billing`: `message-billing.service.ts`, `wallet-gate.service.ts`) and consume `BillingModeService` from this barrel; covered by `test/e2e/wallet-message-billing/engine.e2e.spec.ts` (reseller vs direct mode, idempotent charge, refund, empty-wallet free row) |
| TW-BSP-013                | blocked    | The admin workspace form (create/edit with the reseller flag) is the workspace admin domain's screen; the wallet admin workspace detail already shows and sets the mode |
| TW-BSP-017                | done       | `ratesEndpoint` and the token are this domain's settings; sync/import live in WALLET (`platform-rates.service.ts` `syncMeta` reads the BSP `connection.ratesEndpoint`; live fetch falls back to the bundled card) |
| TW-BSP-002                | done       | Billing menu entries, "Message pricing" link on the credit page, "Rates & margin" link on the P&L page, and `/admin/bsp/rate-cards` redirects to `/admin/wallet/pricing` |
| TW-BSP-018, 019, 020, 021 | not ported | Docs-only or dead code in Reference (no behaviour to port)                                                                                                               |

## Screens

Not compared side by side with the running reference in this run (the reference was not opened); layout follows the inventory descriptions
(KPI tiles, per-workspace table, two-card billing choice, three steps on the credit page).


Tier P0 done: TW-BSP-003, 004, 005, 006, 011, 012, 014, 016. Tier P1 done: TW-BSP-007, 008, 009, 010, 015, 017. Tier P2 done: TW-BSP-001, 002. TW-BSP-013 stays blocked on the workspace admin form.
Round-3 note: the web unit tests (17) pass; the API e2e and integration suites were not re-run because the local Postgres was not reachable (docker daemon down).
Round-4 verification (Postgres up, crm_bsp migrated, 178 migrations): API unit 39, BSP plus wallet-message-billing e2e 156 (6 files), integration 9, web 17 all pass; arch:check and db:verify-schema clean (0 errors). Remaining typecheck errors (8 in api specs, 1 in web plan-draft.test.ts) are in other domains' files. Screens were still not compared side by side with the running Reference.
