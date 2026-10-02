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
| 9   | Customer billing card     | Lives on the WhatsApp devices screen            | Reusable `BillingModeCard` plus its own page `/billing-mode` until the devices screen exists | Devices screen belongs to WADEV, not built    |

## Blocked or not ported (recorded, not dropped)

| Id                        | State      | Reason                                                                                                                                                                |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-BSP-012                | partial    | `BillingModeService` and the Meta cost resolver ship as the contract; the settle/refund/precheck engine that consumes them is the WALLET domain's                     |
| WD-BSP-013                | blocked    | The admin workspace form (create/edit with the reseller flag) is the workspace admin domain's screen                                                                  |
| WD-BSP-017                | partial    | Cost resolution and the rates endpoint setting are ported; the sync/import UI belongs with the WALLET "Message pricing" page                                          |
| WD-BSP-002                | partial    | Billing menu entries ported (Message income, Reseller billing). "Message pricing", the `/admin/bsp/rate-cards` redirect and the "Rates & margin" pill wait for WALLET |
| WD-BSP-018, 019, 020, 021 | not ported | Docs-only or dead code in WaDesk (no behaviour to port)                                                                                                               |

## Screens

Not compared side by side with the running reference in this run (the reference was not opened); layout follows the inventory descriptions
(KPI tiles, per-workspace table, two-card billing choice, three steps on the credit page).
