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
| TW-CAMP-024                | done         | `campaign.created` and `campaign.status_updated` carry Reference's webhook payloads; the bell has completed and failed.                                                                           |
| TW-CAMP-025                | done         | Flow campaigns: the flow runtime's `CampaignFlowStarterImpl` is bound into the campaign sender in the worker (`FlowRuntimeEngineWorkerModule`); one run per recipient with the source `campaign`. |
| TW-CAMP-026                | blocked      | Build with AI waits on ai-keys-usage-admin exporting a text-generation call.                                                                                                                      |
| TW-CAMP-027                | blocked      | Meta click sync waits on a template-analytics call in the Cloud API client.                                                                                                                       |
| TW-CAMP-028                | skipped      | SMS and email campaigns: not ported, on the owner's word.                                                                                                                                         |

## Intended differences from Reference

| #   | Area                     | Reference                                                                     | Here                                                                                                                                       |
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

| #   | Area            | Reference                                    | Here                                                                                             |
| --- | --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 15  | Address         | `/wa-campaigns`                              | `/campaigns` (the domain's route base).                                                          |
| 16  | Media           | Upload an image, video or document           | A public address, until the storage service exists.                                              |
| 17  | CSV             | Uploaded file read on the server             | The file is read in the browser (max 5 MB) and its text sent; the server parses it the same way. |
| 18  | Card resend     | Re-queues and sends to everyone              | The same, with a confirm; the detail page also has "Resend to N failed".                         |
| 19  | Channel chooser | `?channel=sms` and `?channel=email` builders | Not built: SMS and email campaigns are skipped on the owner's word.                              |
| 20  | Build with AI   | A button in the composer                     | Not built (TW-CAMP-026, blocked).                                                                |

## Broadcast wizard (addition)

An **addition** beyond Reference 1.7.0 (TW-CAMP-029 to 035): a four-step "Create broadcast" screen for WhatsApp template broadcasts, asked for by the project
owner. The classic builder (`/campaigns/create`) is unchanged and remains the only way to send custom text, media, flows and A/B tests.

### Comparison with the live reference (http://localhost:8000, read-only)

Reference's `/wa-campaigns/create` is ONE long form: name, sender, campaign type (text, template, button, flow, media, custom), message, audience
(contacts, groups, tags, typed numbers, CSV), schedule (now, scheduled, recurring with a repeat interval and until-date), A/B, Smart Delivery and an
end date. The wizard was compared with it on these points (the reference was read from the source and the inventory; no live WhatsApp session was
used on either side):

| #   | Behaviour                                             | Reference                                                     | Wizard                                                                                          | Verdict                  |
| --- | ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Steps                                                 | one form                                                      | four steps with a stepper, a saved draft and resume                                             | addition                 |
| 2   | Template gate                                         | approved only on Cloud API; OTP refused; media check          | same rules (the classic gate is called at launch), the list only offers usable templates        | same                     |
| 3   | Audience                                              | contacts, groups, tags, numbers, CSV                          | groups, segments and an AND/OR condition builder; no tags/numbers/CSV (use the classic builder) | addition, narrower input |
| 4   | Opted-out contacts                                    | kept on the list, stamped `unsubscribed` at run start         | removed from the count and the recipients up front, shown as "skipped"                          | intended                 |
| 5   | Wallet                                                | precheck at launch (TW-WALLET-013)                            | the same precheck, plus a visible credit check and shortfall before Next                        | same + addition          |
| 6   | Variables                                             | per-template map and send-time overrides                      | per-slot mapping to a field (with fallback) or fixed text, sample messages for real contacts    | addition                 |
| 7   | Schedule                                              | now, scheduled, recurring daily/weekly/monthly + repeat_until | now, scheduled, recurring with every N, weekdays, month day, ends never/on a date/after N runs  | superset                 |
| 8   | Recurring storage                                     | one row re-queued (past runs lost)                            | a series with one child campaign per run                                                        | intended                 |
| 9   | Frequency cap 131049                                  | tried twice, 6 h then 12 h                                    | opt-in retries, exactly 24 h apart, until an end date, attempt log                              | intended                 |
| 10  | Test send                                             | none in the builder                                           | test to up to ten E.164 numbers, logged, charged on delivery                                    | addition                 |
| 11  | A/B, Smart Delivery, end date, flows, custom messages | yes                                                           | not in the wizard                                                                               | classic builder only     |

### Automated evidence

- `apps/api/test/unit/campaigns/recurrence.spec.ts` (23), `wizard-rules.spec.ts` (25), `wizard-contracts.spec.ts` (22), `whatsapp-fixture.spec.ts` (5).
- `apps/api/test/e2e/campaigns/broadcast-wizard.e2e.spec.ts` (35) and `broadcast-wizard-worker.e2e.spec.ts` (28), against real Postgres and Redis: draft to launch in every mode, the series' sequence of runs (weekly, month-end clamp, ends, DST, outage, refused run, two workers), retries only on 131049 exactly 24 h apart and never twice, the test send charged once on delivery, insufficient balance, tenant isolation, permissions.
- `apps/web/src/features/campaigns/wizard/**` unit tests and the en/ar key parity test.
- A browser run of the real UI with screenshots (see the final report of the change).

### Not verified

- **Real Meta/WhatsApp was never called.** All sends in tests and the demo go through the sandbox sender (`CAMP_PROVIDER_MODE=fixture`). Meta's real behaviour for 131049 (which message, when the cap lifts, what the webhook carries) is taken from the inventory (TW-CAMP-012) and Meta's documentation, not observed.
- Cloud API delivery reports now reach campaigns through `WabaReceiptRegistry`; this path is covered through the sandbox's reports (same receipt handler), not through a signed Meta webhook.
- No side-by-side twin run (`threadwise-playwright-parity`) exists for the wizard: Reference has no equivalent screen to run it against.
- Interactive web component tests (typing, clicking, the dialog) are not automated: jsdom and testing-library are not installed in this repo; the logic behind them is unit-tested and the flow was exercised in a real browser.

## Intended difference: unofficial engine off by default (owner decision 2026-10-05)

A campaign that names a personal-number (`baileys`) sender is refused with 422 `WA_UNOFFICIAL_DISABLED` unless a platform super admin turned the unofficial engine on; a blank sender or default engine resolves to `waba`; existing rows on that engine are kept, not sent, and resume when it is turned on. Reference always allowed it. Details and the full list of surfaces: [node-bridge-runtime.md](node-bridge-runtime.md#intended-difference-the-unofficial-engine-is-off-behind-a-platform-switch-owner-decision-2026-10-05).

## Playwright twin run: TW-CAMP-004 (audience step: segments, tags, groups, filters)

Spec `apps/web/e2e/campaigns/parity/TW-CAMP-004.twin.mjs`, depth full, against the running Reference and this branch on a freshly migrated scratch database. Reference's create screen is a stepped wizard with its own picker, so the audience scenarios run on our side only and are judged against absolute expectations.

| Area                                                                  | Result                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create-screen page probes (load, accessibility, degraded, auth, perf) | same as Reference                                                                                                                                                                      |
| Segments, Tags and Groups rows and the three filters                  | present on load; empty rows say so                                                                                                                                                     |
| Consent filter                                                        | refetches from the server (`unsubscribed=true`, 200); Clear filters restores the list                                                                                                  |
| A segment picked as audience                                          | the chip checks, a draft saves (201); the test segment and draft are removed again                                                                                                     |
| Keyboard reach                                                        | 64 of 76 in the probe; intended: the contact table scrolls in a fixed box so the probe stops at the first repeated position; tabbing 120 times reaches every control (checked by hand) |
| Structure (landmarks, markup counts, nav collapse)                    | differs by design (our shell, a table instead of a wizard step); reviewed, no defect                                                                                                   |

Small touch targets (fixed after the run): the 16 px checkboxes in the audience picker are now 24 px inside a 44 px clickable cell, and the chip checkboxes cover their whole chip; the probe's count fell from 33 to 6 (Reference 5, the rest outside the picker). Not covered: the launch path (it sends), a broadcast-screen twin.

## Playwright twin run: TW-CAMP-002 (campaigns list and the five-step campaign builder)

Spec `apps/web/e2e/campaigns/parity/TW-CAMP-002.twin.mjs` (with `TW-CAMP-004.twin.mjs` updated to walk Setup and Compose first), depth full, against the running Reference and this branch. The builder is now Reference's five steps (Setup, Compose, Recipients, Schedule, Review) with the live preview beside them, the "Draft / unsaved" chip, **Build with AI** and **Save draft** in the header; the list has Reference's tip card, five tiles with their sub-lines, the status and message-type views, the date pills, the "No data found" state and three help cards.

| Area                                                                                            | Result                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| List: heading, five tiles, seven status views, four type views, range pills, search, help cards | same (27 checks)                                           |
| List: a search with no match                                                                    | "No data found", Reset filters and Create campaign on both |
| Builder: five steps, three campaign types, A/B, Build with AI, Save draft, draft chip, preview  | same (15 checks)                                           |
| Build with AI dialog                                                                            | same nine fields and the Generate button (11 checks)       |
| Next with no name                                                                               | stays on Setup on both                                     |
| Page probes (load, accessibility, degraded, auth, perf) on the list and the builder             | same, after the fixes below                                |
| Audience scenarios on ours (rows and filters, consent filter, a segment as audience)            | pass through the new Recipients step                       |

Fixed after the first run: the list showed a spinner through the read retries when every request failed (it now shows its error state at once); heading order (the help cards are `h2`); two `main` landmarks (the pages sit inside the shell's); unlabelled `aside` landmarks; missing focus rings on the choice cards, stepper, button tabs, date pills and rail rows.

Also fixed after the last runs: the 16 px select checkboxes and the short campaign names were under the 24 px touch-target floor; the keyboard probe's one stop without a focus ring is the Next.js dev-tools button, which only the dev server renders (intended, recorded in both specs). The final run has no defects; the 18 review items are structure counts that differ by design (our shell and left sidebar instead of Reference's top menu, more buttons and landmarks in the shell).

The sending number decides what a campaign can be, as in Reference's engine gate (`lib/engine-gate.ts`): a Meta number (the workspace's "Test Number" included) offers only **Use template**, shows only that number's approved templates under the label "Approved template", and drops buttons; a Twilio number keeps custom text and media but drops buttons and shows its own templates; the unofficial engine keeps everything. With no number picked, every type and every template is offered, exactly as Reference's builder starts (its sender list starts on "Select a sender"); the gate applies only once a number is chosen, and clearing the choice brings everything back. The sender list has no "Default sender" entry: it starts on "Select a sender" and Setup will not go on without one (a draft can still be saved without), as in Reference. The server already enforced the matching rules (custom sends on Meta, buttons on Meta and Twilio, pacing for the official engines).

Not verified: Reference's own Compose, Recipients, Schedule and Review steps stay behind "Add a WhatsApp device" until a device is connected, so those steps were compared from Reference's source (the field names and copy) and not live. "Build with AI" was run against a stubbed vendor (e2e) and never against a real OpenAI, Anthropic or Gemini key.

## Removed: Broadcast history, Scheduled broadcasts and Recurring broadcasts (owner request 2026-10-08)

The three Campaigns menu entries and their pages (`/campaigns/history`, `/campaigns/scheduled`, `/campaigns/recurring`), their screens and tests (`features/campaigns/history/`), the "Broadcast history" help guide and the `campaigns.history` messages are gone. After a wizard launch the person now lands on that broadcast's own status page (`/campaigns/wizard/broadcasts/<id>`), which keeps the runs, the next run, the retries and pause, resume and cancel; the Broadcasts screen still lists wizard broadcasts at the top. Left in place on purpose: the API's `GET /broadcast-wizard/history` and its contract (no screen reads it now) and the two sort-index migrations behind it; removing them is a separate API and migration decision.

## Email campaigns (TW-CAMP-028, the email half; Reference `?channel=email`)

Behaviour compared from Reference's source (`WaCampaignsController` `$isEmailCampaign` and `runCampaignNowPaced`, `Services/Mailtrixy/EmailCampaignRunner.php`, `wa-campaigns/create.blade.php`, `Documentation/pages/channels/email.html`), not against a running Reference with a mailbox (Reference's mail bridge, MailTrixy, was not available). A Playwright twin run is not recorded for this change.

| Area                                                                                       | Result                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sender is a connected mailbox, picker lists mailboxes only on the email card               | same (`?channel=email`); a personal mailbox is offered to its owner only (intended: Reference has no personal mailboxes)                                                                                                                  |
| Template picker, flow, A/B hidden; Header becomes Subject (max 150), blank = campaign name | same; the server also refuses them (intended: a hand-made request cannot get another answer than the screen)                                                                                                                              |
| Attachment and per-message pacing hidden                                                   | same; the server clears the pacing fields, send window and daily cap (Reference's mail runner ignores them)                                                                                                                               |
| Footer and buttons                                                                         | intended difference: Reference shows them on the email builder but its runner drops them; here they are hidden and cleared                                                                                                                |
| Recipients: contacts with an address, opted-out dropped, repeated address mailed once      | same, with Reference's wording on the rows; compared lower-cased. Reference could not compare addresses in SQL (encrypted column), so it hydrated every contact; here it is one query                                                     |
| Subject CR/LF stripped after the merge; body HTML-escaped with a text part                 | same; cut at 255 as Reference; the unsubscribe link (text, HTML and RFC 8058 headers) is added to every mail (intended: marketing mail without a way out is refused; Reference's runner added none)                                       |
| Plan flag and monthly cap                                                                  | same: `email_channel` (Reference `access_email`) and the new `email_monthly` (Reference `email_monthly_limit`, counted from outbound email messages of the month); the cap is also counted per mail inside a run (Reference checked once) |
| Per-campaign lock, auto-end date, Pause and Cancel mid-run                                 | same (the campaign run lock; the operator's `expiresAt` only, the WhatsApp 24-hour default does not apply to a mail)                                                                                                                      |
| Wallet                                                                                     | same: never charged, never checked (Reference: own plan cap)                                                                                                                                                                              |
| Inbox mirror                                                                               | intended difference: each mail opens a thread with the provider's thread id (Reference keyed one thread per address); the reply joins it                                                                                                  |
| Mailbox hourly cap, bounce list                                                            | addition (Reference had neither for campaigns): the run waits for the cap and continues later; a hard-bounced address is refused for good                                                                                                 |
| Time budget                                                                                | intended difference: Reference stopped after 20 seconds and re-armed (a PHP request limit); the queue worker has no such limit                                                                                                            |

Not verified: nothing was run against a real Gmail, Microsoft 365 or IMAP mailbox. The e2e spec (`test/e2e/campaigns/campaigns-email.e2e.spec.ts`) runs the real app and Postgres with Gmail as the local stand-in the mailbox specs use; the Microsoft and IMAP send paths are covered by their own driver specs, not by a campaign. Delivery, read and bounce reports for a campaign mail (blocked `CAMP-EMAIL-B1`), replies and clicks counters (`B2`), pausing on a mailbox that needs reconnecting (`B3`) and attachments or rich HTML (`B4`) are recorded in the wiring map.
