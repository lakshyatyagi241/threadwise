# Parity evidence: broadcasts (BCAST), create flow and sender

WaDesk 1.7.0 vs branch `punya/broadcasts/WD-BCAST-009-store-request`. Covers WD-BCAST-009, 010, 011, 012, 013, 014 and 015: the
`POST /broadcasts` create flow, plus the sender (WD-BCAST-016 and the simple core of 025, 026, 027). API reference: [docs/api/broadcasts.md](../../api/broadcasts.md).

Evidence is automated, no screen yet:

- `apps/api/test/e2e/broadcasts/broadcasts-payload.e2e.spec.ts`: 10 scenarios for the payload and overrides (acceptance criteria of WD-BCAST-017 and 015 rule 3).
- `apps/api/test/e2e/broadcasts/broadcasts-dispatch.e2e.spec.ts`: 14 scenarios for queueing and sending, against real Postgres with a fake engine adapter.
- `apps/api/test/e2e/broadcasts/broadcasts-create.e2e.spec.ts`: 17 scenarios through HTTP against real Postgres (every
  Given/When/Then of 009, 010, 014, 015, the OTP-template refusal of 012, tenant isolation, permission, auth).
- `apps/api/test/unit/broadcasts/*`: 94 tests for the audience split, template guards, schedule instant, recipient state machine, phone assembly, the Meta payload builder, the variables and the overrides.

## Status of each feature in this PR

| Id           | Status       | Note                                                                                                                                                                   |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-BCAST-009 | backend-done | Plan cap, validation, order of checks. Plan **feature flag** `broadcast` is stubbed (see below). No screen yet.                                                        |
| WD-BCAST-010 | backend-done | Contacts, groups, tags, opt-out removal, tenant scoping.                                                                                                               |
| WD-BCAST-011 | stubbed      | `SendPolicyService` (emergency halt, content screen) is wired for real. The **wallet precheck** is a shim until the wallet domain exposes it.                          |
| WD-BCAST-012 | backend-done | OTP-template refusal, public-https media check, Meta approval/pause/RED guards. Two inputs are stubbed (below).                                                        |
| WD-BCAST-013 | stubbed      | Warmer hold is a shim that never holds until the warmer domain exposes it.                                                                                             |
| WD-BCAST-014 | backend-done | Weighted split, floor plus largest-fraction remainder, empty slices skipped.                                                                                           |
| WD-BCAST-015 | backend-done | Rows and recipients in one transaction, audit and `broadcast.created` outbox event.                                                                                    |
| WD-BCAST-016 | backend-done | Due broadcasts go to BullMQ, a worker resolves sender and template and sends each recipient. Only the `waba` engine has an adapter; see below.                         |
| WD-BCAST-017 | backend-done | Per-recipient Cloud API components (variables, header text and media, buttons, carousel, catalog) and the send-time overrides. `waba` only; see the differences below. |
| WD-BCAST-025 | partial      | Recipient status through one state machine (`BroadcastProgressService`). The HTTP callback is not needed (the worker calls the service).                               |
| WD-BCAST-026 | partial      | Terminal status derived from the recipient rows. Counts are recomputed, not trusted.                                                                                   |
| WD-BCAST-027 | partial      | Counters and the state machine are in. The Meta and Twilio webhook branches that call it are the WABA domain's.                                                        |

## Intended differences from WaDesk

| #   | Area               | WaDesk                                                                                                | Here                                                                                                                        |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scheduled instant  | Date and time read in the server zone; the chosen zone is only stored (09:00 Kolkata fires 09:00 UTC) | Read in the chosen zone and stored as UTC (09:00 Kolkata is 03:30 UTC). The inventory's port requirement (WD-BCAST-015).    |
| 2   | Template required  | Optional on the server although the form requires it; every recipient then fails at send              | `templateId` is required (WD-BCAST-009 quirk 6).                                                                            |
| 3   | Bad schedule input | Unparsable time throws (HTTP 500)                                                                     | 422 validation on `sendDate`, `sendTime` and `timezone`.                                                                    |
| 4   | Ids and keys       | Integer ids; sender keys `engine:id` or a bare id                                                     | Uuids; sender keys `engine:uuid`. A bare id is not accepted.                                                                |
| 5   | Archived contacts  | No such state                                                                                         | Archived contacts are not in the audience (they are the CRM's hidden contacts).                                             |
| 6   | Cross-tenant ids   | Global `exists:` checks, then workspace scoping drops foreign ids                                     | Uuids are only looked up inside the caller's organization; a foreign id is indistinguishable from an unknown one.           |
| 7   | Past schedule      | No check; Node waits for the next yearly cron match                                                   | No check either; the runner will treat a past instant as due immediately (WD-BCAST-021 replaces Node's in-memory schedule). |
| 8   | Response           | Redirect with a flash, or `{ok, broadcast_id, broadcast_ids, devices_count}` for JSON callers         | `201 { broadcasts[], devicesCount }`; the web screen builds its own message.                                                |

| 9 | Dispatch | Synchronous HTTP call to Node (15 s per slice); a scheduled broadcast lives only in Node's memory | BullMQ job per broadcast; the broadcast row is the schedule, so a restart loses nothing. |
| 10 | Recipient without a number | Stays `pending` forever, kept out of the payload | Failed with `No usable phone number`, so the broadcast can finish. |
| 11 | Run outcome | Node posts counts that can overwrite the totals; `paused` was rejected with 422 | Derived from the recipient rows; `paused` (emergency halt) is accepted. |
| 12 | State machine | Only the Meta and Twilio paths had one; Node callbacks could move a row backwards | One machine for every source. |
| 13 | Prebuild trigger | Meta payloads are prebuilt only for an approved template and only when the v2 switch is on or the template has media, buttons or a carousel; Node's fallback handles plain text | The same builder runs for every `waba` recipient (a superset: a plain text template gets the same components the fallback built). |
| 14 | Location header | `header_location` was never passed on this path, so a location template lost its header and Meta rejected it (#132012) | The template's coordinates are used. |
| 15 | Overrides on other engines | Baileys and Twilio slices ignore overrides (WD-BCAST-017 quirk 10); the UI shows the panel for all engines | Kept: only `waba` applies them until those engines have an adapter that renders text. The panel should be hidden for them. |
| 16 | `business_name` token | The sending number's verified Meta name, else the workspace name | The organization name, from the shared merge-tag resolver (CON). Map the slot to a workspace attribute to pin another value. |
| 17 | Blank value fallback | The template example, then the placeholder name, then `-`; an example that is a plain variable-map entry scalarizes to its key | Same, kept exactly (a contact with no first name can receive the word `first_name`). Worth a product decision. |

## Stubbed inputs (blocked on other domains), all behind interfaces in `modules/broadcasts/_shims/`

| Shim                | Real owner                       | What is missing until then                                                                                                                                                                                                                          |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SenderDirectory`   | WADEV / WABA (`WorkspaceEngine`) | Reads `devices` and `wa_provider_configs` directly; "connected" is `status = 'connected'` (and `active` for Baileys).                                                                                                                               |
| `TemplateDirectory` | TPL                              | Reads `wa_templates` directly. Stored media paths cannot be turned into URLs, so the media check only runs for absolute URLs. The `waba_templates_v2_enabled` platform switch is read as off, so the Meta approval/pause/RED guards do not run yet. |
| `WalletGate`        | WALLET (`SendGate` precheck)     | No balance check.                                                                                                                                                                                                                                   |
| `WarmerGate`        | SCHED (`WarmerService`)          | No warm-up holds.                                                                                                                                                                                                                                   |
| `BroadcastPlanGate` | PLAN                             | The `broadcast` feature flag is not in the plan catalogue (only the numeric cap `broadcasts` is), so it is not enforced.                                                                                                                            |

Also not there yet, so this PR sends text templates only:

- Engines: only `waba` (Meta Cloud API) has an adapter. `baileys`, `twilio` and `sms` broadcasts fail at dispatch with a clear log until their adapters exist (WADEV, NODE and the SMS channel).
- Link tracking (018), pacing, batching and the daily cap (022), delivery and read receipts (024, with 027's webhooks), retry of failed recipients (038, 039), team-inbox mirroring (028), outbound webhooks and notifications (029).
- The WABA credentials format (`credentials_json`) is read as encrypted JSON with `access_token` and `phone_number_id`; the WABA domain owns the final format.

Header media paths: only an absolute URL is turned into a link until the storage domain exposes `media_url`; a stored relative path leaves the header out of the payload.

## Not verified

- No screen exists yet, so the Playwright twin run against the running WaDesk has not been done for this PR. The compose page
  (WD-BCAST-003..008) and the list page are the next PRs.
- A real send to Meta has not been run (no credentials here). The adapter is covered by a payload unit test and the pipeline by the fake-adapter e2e; the live stack was checked up to the provider call.
- The three Meta guardrails are covered by unit tests only, because the switch that turns them on is stubbed.
- The tracker (`tracker.py`) and the ownership check could not be used: `ownership.json` still lists broadcasts under another owner.
