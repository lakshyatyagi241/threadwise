# Parity evidence: broadcasts (BCAST), create flow and sender

WaDesk 1.7.0 vs branch `punya/broadcasts/WD-BCAST-009-store-request`. Covers WD-BCAST-009, 010, 011, 012, 013, 014 and 015: the
`POST /broadcasts` create flow, plus the sender (WD-BCAST-016 and the simple core of 025, 026, 027). API reference: [docs/api/broadcasts.md](../../api/broadcasts.md).

Evidence is automated, no screen yet:

- `apps/api/test/e2e/broadcasts/broadcasts-pacing.e2e.spec.ts`: 14 scenarios for the gap, batches, the cap, pause, resume and the sender lease.
- `apps/api/test/e2e/broadcasts/broadcasts-tracking.e2e.spec.ts`: 11 scenarios for wrapping, the redirect, bots, expiry and the counters.
- `apps/api/test/e2e/broadcasts/broadcasts-actions.e2e.spec.ts`: 16 scenarios for delete, retry, the sweep and the CSV export.
- `apps/api/test/e2e/broadcasts/broadcasts-read.e2e.spec.ts`: 20 scenarios for the list, tiles, detail, recipients and live counters.
- `apps/api/test/e2e/broadcasts/broadcasts-payload.e2e.spec.ts`: 10 scenarios for the payload and overrides (acceptance criteria of WD-BCAST-017 and 015 rule 3).
- `apps/api/test/e2e/broadcasts/broadcasts-dispatch.e2e.spec.ts`: 14 scenarios for queueing and sending, against real Postgres with a fake engine adapter.
- `apps/api/test/e2e/broadcasts/broadcasts-create.e2e.spec.ts`: 17 scenarios through HTTP against real Postgres (every
  Given/When/Then of 009, 010, 014, 015, the OTP-template refusal of 012, tenant isolation, permission, auth).
- `apps/api/test/unit/broadcasts/*`: 138 tests for the audience split, template guards, schedule instant, recipient state machine, phone assembly, the Meta payload builder, the variables and the overrides.

## Status of each feature in this PR

| Id                  | Status       | Note                                                                                                                                                                      |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-BCAST-009        | backend-done | Plan cap, validation, order of checks. Plan **feature flag** `broadcast` is stubbed (see below). No screen yet.                                                           |
| WD-BCAST-010        | backend-done | Contacts, groups, tags, opt-out removal, tenant scoping.                                                                                                                  |
| WD-BCAST-011        | stubbed      | `SendPolicyService` (emergency halt, content screen) is wired for real. The **wallet precheck** is a shim until the wallet domain exposes it.                             |
| WD-BCAST-012        | backend-done | OTP-template refusal, public-https media check, Meta approval/pause/RED guards. Two inputs are stubbed (below).                                                           |
| WD-BCAST-013        | stubbed      | Warmer hold is a shim that never holds until the warmer domain exposes it.                                                                                                |
| WD-BCAST-014        | backend-done | Weighted split, floor plus largest-fraction remainder, empty slices skipped.                                                                                              |
| WD-BCAST-015        | backend-done | Rows and recipients in one transaction, audit and `broadcast.created` outbox event.                                                                                       |
| WD-BCAST-016        | backend-done | Due broadcasts go to BullMQ, a worker resolves sender and template and sends each recipient. Only the `waba` engine has an adapter; see below.                            |
| WD-BCAST-017        | backend-done | Per-recipient Cloud API components (variables, header text and media, buttons, carousel, catalog) and the send-time overrides. `waba` only; see the differences below.    |
| WD-BCAST-001        | backend-done | List with status, range and name filters, cursor pages. No screen yet.                                                                                                    |
| WD-BCAST-002        | backend-done | Tiles and status counts; Processing and Queued now come from the recipient rows.                                                                                          |
| WD-BCAST-030 to 036 | backend-done | Detail, recipients, live counters and statistics as endpoints; the overview charts' data, the failure histogram and the events are in the detail response. No screen yet. |
| WD-BCAST-025        | partial      | Recipient status through one state machine (`BroadcastProgressService`). The HTTP callback is not needed (the worker calls the service).                                  |
| WD-BCAST-026        | partial      | Terminal status derived from the recipient rows. Counts are recomputed, not trusted.                                                                                      |
| WD-BCAST-027        | partial      | Counters and the state machine are in. The Meta and Twilio webhook branches that call it are the WABA domain's.                                                           |

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
| 18 | List paging | Page numbers, 12 per page, all rows loaded and filtered in PHP because the name is encrypted | Keyset cursor, 12 by default, filtered in SQL; the name is plain text. |
| 19 | List scope | Only rows whose engine is enabled for the workspace; the tile sums included the hidden ones | Every broadcast of the organization, in the list and the tiles alike. |
| 20 | Tiles Processing and Queued | Read from a table broadcasts never write, so always 0 | Recipients being sent or sent and not yet delivered; recipients waiting. |
| 21 | Detail recipients | Two sources merged per contact (one keyed by a scheduled-message id that can collide); every recipient rendered, filtered in the browser | One source; filtered and paged on the server. |
| 22 | Unknown contact | "Contact #id" | "Unknown contact" (internal ids do not leave the system). |
| 23 | Detail sender | Looked up in `devices` even for a Cloud API slice, so the label could be wrong | The sender row the broadcast names, in its own table. |
| 24 | Statistics response | `{success, stats}` | Plain counts (the envelope belongs to the old HTML routes). |
| 25 | Manual retry precondition | No status check, so a retry during a run started a second concurrent loop; none of the guards were re-checked | Refused while `processing` or `scheduled` (409); halt and wallet checked again (the WD-BCAST-038 port notes). |
| 26 | Retry resets | `send_attempts` untouched | Reset to 0, so the automatic retry starts fresh after an operator retry. |
| 27 | Sweep trigger | The Node heartbeat, at most once per 120 s, only while a Baileys socket is up | Its own 60 s interval in the worker, for every engine. |
| 28 | Sweep candidates | Includes a still-running broadcast, so a second loop could start on it | Finished broadcasts only; permanent failures (no number, Meta undeliverable) are left for manual review. |
| 29 | Delete | Best-effort cancel call to Node, then delete | The queued job is withdrawn, then delete; a run that already started finds the row gone and stops. |
| 30 | CSV times | The workspace time zone, while the detail page used the broadcast's | The broadcast's own zone, the same as the detail page. The `Failed` time is the recipient's last update (there is no `failed_at`). |
| 31 | CSV file name | `broadcast-<numeric id>-...` | `broadcast-<uuid>-...` (internal ids do not leave the system). |
| 32 | Clicked count | Counted a contact again when a second address tapped the same link (the check compared row ids), and not at all for a first tap from a crawler that was counted as a unique hit | Contacts who clicked: once per contact per broadcast, serialised so two taps at once cannot both be first. |
| 33 | Static URL buttons | Wrapped (a link row was minted) even though a static URL is never sent as a parameter | Only buttons the template gives a parameter to are wrapped. |
| 34 | Tenant lookup for the public route | Plain query, no row-level security | A SECURITY DEFINER function returns four columns for one token (`bcast_link_lookup`); the click is then recorded under the tenant context. **Reviewer decision:** this is a new place that resolves a tenant before one exists, like the API-key and login lookups, but it is not `privileged()`; `multi-tenancy.md` lists four sanctioned uses and does not mention it. |
| 35 | Settings | `waba_link_tracking_enabled` and `wa_link_tracking_ttl_days` system settings | Environment `LINK_TRACKING_ENABLED` and `LINK_TRACKING_TTL_DAYS` until the settings domain exposes them. |
| 36 | Unique visitor and rate | A one-hour cache per link and address | Same, in Redis; plus a 600 hits a minute cap per address on the public route. |
| 37 | Pause | `paused` was rejected by Laravel's own callback (422), so a pause never reached the database and nothing resumed the run | A real `paused` status with the reason, a manual resume, and an automatic resume for a daily cap and for a lifted halt. |
| 38 | Daily cap tally | In Node's memory, so a restart reset it; the setting was never fetched so it was always 4000 | In Redis, shared by every worker; the cap is a setting (default 4000). |
| 39 | Concurrency | Strictly sequential per broadcast, no limit across broadcasts of one sender | One run per sender at a time, by a lease. |
| 40 | Socket-drop pause | Baileys socket check before each recipient | Belongs to the Baileys adapter (WADEV), not built; the emergency halt pause is the one that exists. |
| 41 | `waba` falling back to Baileys | A `waba` row with incomplete settings silently took the Baileys path and failed for lack of a socket | A `waba` broadcast whose credentials are missing fails at dispatch with a clear reason. |

## Stubbed inputs (blocked on other domains), all behind interfaces in `modules/broadcasts/_shims/`

| Shim                | Real owner                       | What is missing until then                                                                                                                                                                                                                          |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SenderDirectory`   | WADEV / WABA (`WorkspaceEngine`) | Reads `devices` and `wa_provider_configs` directly; "connected" is `status = 'connected'` (and `active` for Baileys).                                                                                                                               |
| `TemplateDirectory` | TPL                              | Reads `wa_templates` directly. Stored media paths cannot be turned into URLs, so the media check only runs for absolute URLs. The `waba_templates_v2_enabled` platform switch is read as off, so the Meta approval/pause/RED guards do not run yet. |
| `WalletGate`        | WALLET (`SendGate` precheck)     | No balance check.                                                                                                                                                                                                                                   |
| `WarmerGate`        | SCHED (`WarmerService`)          | No warm-up holds and no warm-up gap range.                                                                                                                                                                                                          |
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
