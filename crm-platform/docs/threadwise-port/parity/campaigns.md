# Parity evidence: campaigns (CAMP)

Reference 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/campaigns.md](../inventory/campaigns.md). API reference:
[docs/api/campaigns.md](../../api/campaigns.md).

Evidence so far is automated (the screens are listed under Screens (C4); none has been run side by side with Reference):

- `apps/api/test/unit/campaigns/campaign-rules.spec.ts`: 24 tests (named to positional variables, typed numbers and CSV, media kind, schedule in a zone, recurring dates, the window past midnight, retry backoff and the Meta throttle, the A/B split, the forward-only status rule, finishing a campaign).
- `apps/api/test/e2e/campaigns/campaigns-create.e2e.spec.ts`: 18 scenarios (the audience union, forged ids, opted-out kept, A/B split on the rows, sender and engine, template gate, variant B ownership, named variables, media, schedule and end-date guard, Smart Delivery, edit rules and rebuild, list filters and tiles with counts from the rows, detail, builder, sample CSV, isolation, permissions).
- `apps/api/test/e2e/campaigns/campaigns-actions.e2e.spec.ts`: 9 scenarios (cancel, resume, send now, resend failed, all, selected, the refusals, delete and bulk delete, the CSV export, permissions).
- `apps/api/test/e2e/campaigns/campaigns-dispatch.e2e.spec.ts`: 20 scenarios against a fake engine (a full run, opt-outs and duplicates, link tracking, A/B messages, a custom message on an engine that cannot send one, a template send, the inbox bubble, retries with the sweeper, the attempt cap, the daily limit, the window, the gap, cancelling mid-run, the end date, recurring and its repeat-until, a flow campaign, two runs at once, the sweeper's stalled and dead-claim rescue).
- `apps/api/test/e2e/campaigns/campaigns-callbacks.e2e.spec.ts`: 7 scenarios (the bridge token, campaign and recipient status, status by message id forward only, a reply, a STOP, the drain tick).

## Status of each feature

| Feature                    | Status       | Notes                                                                                                                                                                                             |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-CAMP-001                | backend-done | `GET /campaigns`: filters, tiles, status and type counts, health cards; the opening sweep is the worker's sweeper. Screen: `/campaigns`.                                                          |
| TW-CAMP-002                | backend-done | `GET /campaigns/builder`: senders and templates through broadcasts' compose, groups and tags with counts, flows.                                                                                  |
| TW-CAMP-003, 004           | backend-done | Create with the audience union and the CSV. Media: an address, or a file uploaded through `POST /v2/media/marketing` (needs cloud object storage).                                                |
| TW-CAMP-005, 006, 007      | backend-done | Template gate, named to positional, one media, A/B with variant B ownership.                                                                                                                      |
| TW-CAMP-008, 009           | backend-done | Schedule in the campaign's zone, recurring, end-date guard, Smart Delivery fields.                                                                                                                |
| TW-CAMP-010                | backend-done | Edit rules and recipient rebuild.                                                                                                                                                                 |
| TW-CAMP-011, 012, 013, 014 | backend-done | The sender job and the sweeper. Engines: the Cloud API, plus Baileys and Twilio through the Node bridge's outbound registry (plain text and media).                                               |
| TW-CAMP-015                | backend-done | Links in a custom text and URL buttons of a Cloud template are wrapped per recipient.                                                                                                             |
| TW-CAMP-016, 017, 018, 020 | backend-done | Cancel, resume, send now, resend, delete, bulk delete, export.                                                                                                                                    |
| TW-CAMP-019                | done         | The detail read model with the Engagement tab: engagement, per-button clicks, top groups by read rate, the opt-out list, and the message-log search.                                              |
| TW-CAMP-021, 022           | backend-done | Node callbacks and the provider receipt state machine; a webhook handler must call `CampaignReceiptsService.handle`.                                                                              |
| TW-CAMP-023                | backend-done | Inbox bubble at send and on receipt, once per recipient.                                                                                                                                          |
| TW-CAMP-024                | done         | `campaign.created` and `campaign.status_updated` carry Reference's webhook payloads; the bell has completed and failed.                                                                              |
| TW-CAMP-025                | done         | Flow campaigns: the flow runtime's `CampaignFlowStarterImpl` is bound into the campaign sender in the worker (`FlowRuntimeEngineWorkerModule`); one run per recipient with the source `campaign`. |
| TW-CAMP-026                | blocked      | Build with AI waits on ai-keys-usage-admin exporting a text-generation call.                                                                                                                      |
| TW-CAMP-027                | blocked      | Meta click sync waits on a template-analytics call in the Cloud API client.                                                                                                                       |
| TW-CAMP-028                | skipped      | SMS and email campaigns: not ported, on the owner's word.                                                                                                                                         |

## Intended differences from Reference

| #   | Area                     | Reference                                                                        | Here                                                                                                                                       |
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

| Shim                             | Real owner                         | Effect now                                                                                                                             |
| -------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CampaignPlanGate`               | plans-subscriptions-trials         | Real: the `total_campaigns` cap, on the campaigns that exist now (no delete-proof ledger). No `campaign` flag exists in the catalogue. |
| `CampaignBilling`                | wallet-message-billing             | Plan-first billing is not applied: nothing is charged or refunded.                                                                     |
| `CampaignFlowStarter`            | flow-runtime-engine                | Real in the worker (bound at start); the HTTP process never runs a campaign.                                                           |
| `CampaignSettings`               | platform-settings-branding-storage | Real: the `campaigns` settings group, edited at `/admin/settings/campaigns` (retry attempts, wait, auto-end).                          |
| Sender, template, warmer, pacing | shared with broadcasts             | Same shims and defaults as broadcasts (`modules/broadcasts/_shims`).                                                                   |
| Engines                          | whatsapp-devices-baileys, Twilio   | Real, through the Node bridge's outbound registry.                                                                                     |

## Not verified

- The screens have not been run side by side with Reference (Playwright twin run): the dev sign-in is the user's, not typed by the assistant.
- No real provider call was made (no Cloud API credentials here): sends go through a fake engine in the tests.
- The 5-second sweeper cadence and the 20-second lock heartbeat were not run against a long campaign.

## Screens (C4)

`apps/web/src/features/campaigns`: list `/campaigns`, builder `/campaigns/create` and `/campaigns/:id/edit`, detail `/campaigns/:id`; nav
entry in the Campaigns group (the planned placeholder is removed); messages `messages/en/campaigns.json`. `list-model.test.ts` and
`builder-model.test.ts` cover the filters in the address, what each status allows, the request body, and what still stops a form from saving.
The builder reuses broadcasts' audience picker, send-time overrides panel, attribute catalog and the area chart, donut and bars.

| #   | Area            | Reference                                       | Here                                                                                             |
| --- | --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 15  | Address         | `/wa-campaigns`                              | `/campaigns` (the domain's route base).                                                          |
| 16  | Media           | Upload an image, video or document           | A public address, until the storage service exists.                                              |
| 17  | CSV             | Uploaded file read on the server             | The file is read in the browser (max 5 MB) and its text sent; the server parses it the same way. |
| 18  | Card resend     | Re-queues and sends to everyone              | The same, with a confirm; the detail page also has "Resend to N failed".                         |
| 19  | Channel chooser | `?channel=sms` and `?channel=email` builders | Not built: SMS and email campaigns are skipped on the owner's word.                              |
| 20  | Build with AI   | A button in the composer                     | Not built (TW-CAMP-026, blocked).                                                                |

## Intended difference: unofficial engine off by default (owner decision 2026-10-05)

A campaign that names a personal-number (`baileys`) sender is refused with 422 `WA_UNOFFICIAL_DISABLED` unless a platform super admin turned the unofficial engine on; a blank sender or default engine resolves to `waba`; existing rows on that engine are kept, not sent, and resume when it is turned on. Reference always allowed it. Details and the full list of surfaces: [node-bridge-runtime.md](node-bridge-runtime.md#intended-difference-the-unofficial-engine-is-off-behind-a-platform-switch-owner-decision-2026-10-05).
