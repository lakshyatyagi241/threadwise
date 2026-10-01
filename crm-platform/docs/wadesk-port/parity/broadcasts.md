# Parity evidence: broadcasts (BCAST), create flow

WaDesk 1.7.0 vs branch `punya/broadcasts/WD-BCAST-009-store-request`. Covers WD-BCAST-009, 010, 011, 012, 013, 014 and 015: the
`POST /broadcasts` create flow. API reference: [docs/api/broadcasts.md](../../api/broadcasts.md).

Evidence is automated, no screen yet:

- `apps/api/test/e2e/broadcasts/broadcasts-create.e2e.spec.ts`: 17 scenarios through HTTP against real Postgres (every
  Given/When/Then of 009, 010, 014, 015, the OTP-template refusal of 012, tenant isolation, permission, auth).
- `apps/api/test/unit/broadcasts/*`: 33 tests for the audience split, template guards and media check, and the schedule instant.

## Status of each feature in this PR

| Id           | Status       | Note                                                                                                                                           |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-BCAST-009 | backend-done | Plan cap, validation, order of checks. Plan **feature flag** `broadcast` is stubbed (see below). No screen yet.                                |
| WD-BCAST-010 | backend-done | Contacts, groups, tags, opt-out removal, tenant scoping.                                                                                       |
| WD-BCAST-011 | stubbed      | `SendPolicyService` (emergency halt, content screen) is wired for real. The **wallet precheck** is a shim until the wallet domain exposes it. |
| WD-BCAST-012 | backend-done | OTP-template refusal, public-https media check, Meta approval/pause/RED guards. Two inputs are stubbed (below).                                |
| WD-BCAST-013 | stubbed      | Warmer hold is a shim that never holds until the warmer domain exposes it.                                                                     |
| WD-BCAST-014 | backend-done | Weighted split, floor plus largest-fraction remainder, empty slices skipped.                                                                   |
| WD-BCAST-015 | backend-done | Rows and recipients in one transaction, audit and `broadcast.created` outbox event. Dispatch (016) is the next PR.                            |

## Intended differences from WaDesk

| #   | Area               | WaDesk                                                                                                | Here                                                                                                                         |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scheduled instant  | Date and time read in the server zone; the chosen zone is only stored (09:00 Kolkata fires 09:00 UTC) | Read in the chosen zone and stored as UTC (09:00 Kolkata is 03:30 UTC). The inventory's port requirement (WD-BCAST-015).     |
| 2   | Template required  | Optional on the server although the form requires it; every recipient then fails at send             | `templateId` is required (WD-BCAST-009 quirk 6).                                                                             |
| 3   | Bad schedule input | Unparsable time throws (HTTP 500)                                                                     | 422 validation on `sendDate`, `sendTime` and `timezone`.                                                                     |
| 4   | Ids and keys       | Integer ids; sender keys `engine:id` or a bare id                                                     | Uuids; sender keys `engine:uuid`. A bare id is not accepted.                                                                 |
| 5   | Archived contacts  | No such state                                                                                         | Archived contacts are not in the audience (they are the CRM's hidden contacts).                                              |
| 6   | Cross-tenant ids   | Global `exists:` checks, then workspace scoping drops foreign ids                                     | Uuids are only looked up inside the caller's organization; a foreign id is indistinguishable from an unknown one.            |
| 7   | Past schedule      | No check; Node waits for the next yearly cron match                                                   | No check either; the runner will treat a past instant as due immediately (WD-BCAST-021 replaces Node's in-memory schedule). |
| 8   | Response           | Redirect with a flash, or `{ok, broadcast_id, broadcast_ids, devices_count}` for JSON callers         | `201 { broadcasts[], devicesCount }`; the web screen builds its own message.                                                 |

## Stubbed inputs (blocked on other domains), all behind interfaces in `modules/broadcasts/_shims/`

| Shim                | Real owner                       | What is missing until then                                                                                                                                                                                                                       |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SenderDirectory`   | WADEV / WABA (`WorkspaceEngine`) | Reads `devices` and `wa_provider_configs` directly; "connected" is `status = 'connected'` (and `active` for Baileys).                                                                                                                            |
| `TemplateDirectory` | TPL                              | Reads `wa_templates` directly. Stored media paths cannot be turned into URLs, so the media check only runs for absolute URLs. The `waba_templates_v2_enabled` platform switch is read as off, so the Meta approval/pause/RED guards do not run yet. |
| `WalletGate`        | WALLET (`SendGate` precheck)     | No balance check.                                                                                                                                                                                                                                |
| `WarmerGate`        | SCHED (`WarmerService`)          | No warm-up holds.                                                                                                                                                                                                                                |
| `BroadcastPlanGate` | PLAN                             | The `broadcast` feature flag is not in the plan catalogue (only the numeric cap `broadcasts` is), so it is not enforced.                                                                                                                         |

Also stubbed: `templateOverrides` are only stripped of blank values; the full shape check is WD-BCAST-017.

## Not verified

- No screen exists yet, so the Playwright twin run against the running WaDesk has not been done for this PR. The compose page
  (WD-BCAST-003..008) and the list page are the next PRs.
- Live sending is not part of this PR. Sending through BullMQ is WD-BCAST-016.
- The three Meta guardrails are covered by unit tests only, because the switch that turns them on is stubbed.
- The tracker (`tracker.py`) and the ownership check could not be used: `ownership.json` still lists broadcasts under another owner.
