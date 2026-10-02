# Parity evidence: campaigns (CAMP)

WaDesk 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/campaigns.md](../inventory/campaigns.md). API reference:
[docs/api/campaigns.md](../../api/campaigns.md).

Evidence so far is automated, no screen yet:

- `apps/api/test/unit/campaigns/campaign-rules.spec.ts`: 24 tests (named to positional variables, typed numbers and CSV, media kind, schedule in a zone, recurring dates, the window past midnight, retry backoff and the Meta throttle, the A/B split, the forward-only status rule, finishing a campaign).
- `apps/api/test/e2e/campaigns/campaigns-create.e2e.spec.ts`: 18 scenarios (the audience union, forged ids, opted-out kept, A/B split on the rows, sender and engine, template gate, variant B ownership, named variables, media, schedule and end-date guard, Smart Delivery, edit rules and rebuild, list filters and tiles with counts from the rows, detail, builder, sample CSV, isolation, permissions).
- `apps/api/test/e2e/campaigns/campaigns-actions.e2e.spec.ts`: 9 scenarios (cancel, resume, send now, resend failed, all, selected, the refusals, delete and bulk delete, the CSV export, permissions).
- `apps/api/test/e2e/campaigns/campaigns-dispatch.e2e.spec.ts`: 20 scenarios against a fake engine (a full run, opt-outs and duplicates, link tracking, A/B messages, a custom message on an engine that cannot send one, a template send, the inbox bubble, retries with the sweeper, the attempt cap, the daily limit, the window, the gap, cancelling mid-run, the end date, recurring and its repeat-until, a flow campaign, two runs at once, the sweeper's stalled and dead-claim rescue).
- `apps/api/test/e2e/campaigns/campaigns-callbacks.e2e.spec.ts`: 7 scenarios (the bridge token, campaign and recipient status, status by message id forward only, a reply, a STOP, the drain tick).

## Status of each feature

| Feature                    | Status       | Notes                                                                                                                                                |
| -------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-CAMP-001                | backend-done | `GET /campaigns`: filters, tiles, status and type counts, health cards; the opening sweep is the worker's sweeper. Screen not built yet.             |
| WD-CAMP-002                | backend-done | `GET /campaigns/builder`: senders and templates through broadcasts' compose, groups and tags with counts, flows.                                     |
| WD-CAMP-003, 004           | backend-done | Create with the audience union and the CSV. File upload of media is blocked on storage (an address works).                                           |
| WD-CAMP-005, 006, 007      | backend-done | Template gate, named to positional, one media, A/B with variant B ownership.                                                                         |
| WD-CAMP-008, 009           | backend-done | Schedule in the campaign's zone, recurring, end-date guard, Smart Delivery fields.                                                                   |
| WD-CAMP-010                | backend-done | Edit rules and recipient rebuild.                                                                                                                    |
| WD-CAMP-011, 012, 013, 014 | backend-done | The sender job and the sweeper. Engines: only those registered with `EngineSenderRegistry` (the Cloud API now). See shims.                           |
| WD-CAMP-015                | backend-done | Links in a custom text and URL buttons of a Cloud template are wrapped per recipient.                                                                |
| WD-CAMP-016, 017, 018, 020 | backend-done | Cancel, resume, send now, resend, delete, bulk delete, export.                                                                                       |
| WD-CAMP-019                | partial      | The detail read model. Not yet: segments by contact group, engagement and button rows, the message-log search by decrypted name (done by SQL ILIKE). |
| WD-CAMP-021, 022           | backend-done | Node callbacks and the provider receipt state machine; a webhook handler must call `CampaignReceiptsService.handle`.                                 |
| WD-CAMP-023                | backend-done | Inbox bubble at send and on receipt, once per recipient.                                                                                             |
| WD-CAMP-024                | partial      | Outbox events are emitted. The outbound-webhook and bell mappers for `campaign.*` are not written (BCAST's `webhook-events.ts` is the model).        |
| WD-CAMP-025                | blocked      | Flow campaigns need the flow runtime (shim `CampaignFlowStarter`); recipients fail with the reason.                                                  |
| WD-CAMP-026                | blocked      | Build with AI waits on ai-keys-usage-admin exporting a text-generation call.                                                                         |
| WD-CAMP-027                | blocked      | Meta click sync waits on a template-analytics call in the Cloud API client.                                                                          |
| WD-CAMP-028                | skipped      | SMS and email campaigns: not ported, on the owner's word.                                                                                            |

## Intended differences from WaDesk

| #   | Area                     | WaDesk                                                                        | Here                                                                                                                                       |
| --- | ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Access                   | Workspace admin role and plan flags                                           | Permission keys `camp.campaigns.read, create, update, control, delete, export`.                                                            |
| 2   | Ids                      | Numeric ids in URLs and bodies                                                | Uuids.                                                                                                                                     |
| 3   | The run                  | After the HTTP response, a 20-second chunk re-armed by the Node heartbeat     | A BullMQ job with no time limit; the same stop and re-arm reasons; a sweeper in the worker replaces the heartbeat and the page-load sweep. |
| 4   | Two run at once          | Possible                                                                      | A lock on the campaign and one on the sender (shared with broadcasts) refuse the second; the job waits and retries.                        |
| 5   | `status` on create       | Any string                                                                    | Only `draft`: a client can no longer start a campaign past the checks.                                                                     |
| 6   | No audience              | Created and "running" for ever                                                | 422 `CAMP_NO_RECIPIENTS` (a draft may be empty).                                                                                           |
| 7   | Scheduled without a date | Accepted; the sweeper ignores it for ever                                     | `sendDate` and `sendTime` are required.                                                                                                    |
| 8   | Counters                 | Two definitions (list and node callbacks)                                     | One: the list's (sent includes delivered, read and replied), recomputed from the rows everywhere.                                          |
| 9   | Skipped recipients       | Counted as "remaining", so the campaign re-armed until the list reconciled it | A skipped duplicate is final.                                                                                                              |
| 10  | Name, text columns       | Encrypted at rest, search in PHP                                              | The name is plain so the database can search it; the message, header and footer are encrypted; buttons and maps are stored as JSON.        |
| 11  | Media                    | A file uploaded to `campaign-media`                                           | A public address (storage service not available).                                                                                          |
| 12  | Phone                    | `mobile` hash and encrypted                                                   | Plain under row-level security, like contacts.                                                                                             |
| 13  | Cap on campaigns         | `total_campaigns_limit` on an increment-only ledger                           | Behind `CampaignPlanGate` (open until the plan catalogue has the key).                                                                     |
| 14  | Outbound events          | Fired from the model on every write                                           | Emitted by each writer through the outbox; the names are `campaign.*`.                                                                     |

## Stubbed inputs (shims, in `modules/campaigns/_shims`)

| Shim                             | Real owner                         | Effect now                                                                                               |
| -------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CampaignPlanGate`               | plans-subscriptions-trials         | The `campaign` flag and `total_campaigns_limit` are not enforced.                                        |
| `CampaignBilling`                | wallet-message-billing             | Plan-first billing is not applied: nothing is charged or refunded.                                       |
| `CampaignFlowStarter`            | flow-runtime-engine                | Flow campaigns fail per recipient with the reason.                                                       |
| `CampaignSettings`               | platform-settings-branding-storage | `campaign_retry_attempts` 3, `campaign_retry_backoff_sec` 60, auto-end 24 hours.                         |
| Sender, template, warmer, pacing | shared with broadcasts             | Same shims and defaults as broadcasts (`modules/broadcasts/_shims`).                                     |
| Engines                          | whatsapp-devices-baileys, Twilio   | Only the Cloud API adapter is registered; a campaign on another engine fails at the run with the reason. |

## Not verified

- No screen exists yet, so the Playwright twin run against the running WaDesk has not been done.
- No real provider call was made (no Cloud API credentials here): sends go through a fake engine in the tests.
- The 5-second sweeper cadence and the 20-second lock heartbeat were not run against a long campaign.
