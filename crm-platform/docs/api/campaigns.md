# Campaigns API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every `POST`. A campaign is addressed by its uuid;
so is every contact, group, tag, template, flow and recipient. The Reference reference is `/wa-campaigns`; the inventory is
[inventory/campaigns.md](../threadwise-port/inventory/campaigns.md).

A campaign sends one message from one connected number to an audience. The audience is the union of `contactIds`, the members of
`groupIds` and `tagIds`, the numbers typed in `manualNumbers` and the rows of an uploaded CSV (`csvText`), each person once. Contacts
of another workspace are dropped; archived ones too; opted-out contacts stay on the list and are stamped `unsubscribed` when the run
starts.

## Permissions

| Key                      | What it allows                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| `camp.campaigns.read`    | The list, the builder's pickers, the edit form, the detail and tabs |
| `camp.campaigns.create`  | Create                                                              |
| `camp.campaigns.update`  | Edit                                                                |
| `camp.campaigns.control` | Cancel, resume, send now, resend                                    |
| `camp.campaigns.delete`  | Delete and bulk delete                                              |
| `camp.campaigns.export`  | The recipients CSV                                                  |
| `camp.campaigns.test`    | The broadcast wizard's test send and its log                        |

## Read

| Method and path                 | What it returns                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /campaigns`                | `data` (12 a page), `page`, `stats`, `statusCounts`, `messageTypes`, `deliveryHealth`, `queueHealth`. Query `status`, `type`, `range`, `q`, `page` |
| `GET /campaigns/builder`        | `senders`, `templates`, `groups` and `tags` with member counts, `flows`, `requiresApprovedTemplates`                                               |
| `GET /campaigns/sample-csv`     | `campaign-recipients-sample.csv`: `name,country_code,phone` and two rows                                                                           |
| `GET /campaigns/:id/config`     | The whole campaign for the edit form, with `recipientContactIds` and the end date as typed (`expiresAtLocal`)                                      |
| `GET /campaigns/:id`            | Rates, funnel, hourly and daily charts, outcomes, per-variant results, preview, audience, failures, replies, opt-outs                              |
| `GET /campaigns/:id/live`       | What the detail repaints every 15 seconds: status, counts, rates, newest failures, failure summary                                                 |
| `GET /campaigns/:id/recipients` | The recipient log, 50 a page, filter `status`, search `q` (name or phone)                                                                          |

Every count comes from the recipient rows. The list and the detail also finish a campaign whose recipients are all resolved
(`completed`, or `failed` when nothing was sent), so the screens never disagree with the log. Phone numbers are shown in full
(Reference switched its masking off).

A campaign: `{ id, name, type, status, provider, abTesting, scheduleType, sendDate, sendTime, timezone, repeatInterval, expiresAt,
templateId, templateName, counts { recipients, sent, delivered, read, replies, clicks, failed }, lastRunAt, completedAt, createdAt,
updatedAt, rowVersion }`. `clicks` is the greater of our click count and Meta's, never the sum.

## Create and edit

`POST /campaigns` (201, `{ campaign, message }`) and `PUT /campaigns/:id` (`{ campaign, message }`). The form:

- `name`, `type` (`text`, `template`, `button`, `flow`, `media`, `custom`), `senderKey` (`engine:uuid`; none leaves the workspace's default engine).
- `customMessage` (required for text, custom, button and media), `customMessageB`, `customHeader`, `customFooter`, `customButtons`
  (`url`, `copy_code`, `phone_number` or `quick_reply`, up to three from the builder),
  `customQuickReplies`, `variableMap`, `mediaUrl` (an image jpg, jpeg or png, a video mp4, or a document pdf, doc or docx; uploading waits on the storage service).
- `templateId`, `templateIdA`, `templateIdB`, `templateOverrides`, `templateOverridesB`, `flowId`, `flowIdB`, `useAttributes`, `trackingEnabled`.
- `abTesting`, `abSplit` (percent to A, 0 to 100).
- `scheduleType` (`now`, `scheduled`, `recurring`), `sendDate` (`YYYY-MM-DD`) and `sendTime` (`HH:mm`) required unless `now`,
  `timezone` (IANA), `repeatInterval` (`daily`, `weekly`, `monthly`, default weekly), `repeatUntil`, `expiresAt` (`YYYY-MM-DDTHH:mm`, read in `timezone`).
- Smart Delivery: `throttleMinSec`, `throttleMaxSec` (0 to 3600, max at least min), `batchSize` (1 to 10,000), `batchPauseMin` (0 to 1,440), `dailyLimit` (1 to 100,000), `windowStart`, `windowEnd` (`HH:mm`).
- The audience: `contactIds`, `groupIds`, `tagIds`, `manualNumbers`, `csvText` (max 5 MB of text).
- `status`: only `draft` is accepted (a draft may have an empty audience).

Rules, in Reference's order: plan flag and cap, validation, the end-date guard, the send guardrails, the audience, the template gate,
variant B ownership, then the write (the campaign and every recipient in one transaction). `now` is started after the commit.

- 422 `CAMP_NO_RECIPIENTS`: nobody on the audience (not for a draft).
- 422 `CAMP_TEMPLATE_NOT_ALLOWED`: an OTP template, an unapproved template on the Cloud API, Meta paused or bad quality, media not on a public https address.
- 422 `CAMP_EXPIRY_BEFORE_SEND`: a scheduled or recurring campaign whose end date is not after its send moment.
- 422 `VALIDATION_FAILED`: a template, flow or sender that does not belong to the workspace, an unknown time zone, an unsupported media kind.
- A named variable (`{{order_id}}`) is stored positional (`{{1}}`) with its map; the edit form gets it back that way.
- Cloud API and Twilio custom sends drop buttons and quick replies.
- Edit: 422 `CAMP_NOT_EDITABLE` unless `draft`, `scheduled` or `paused`. An audience that is sent and not empty replaces the recipients.
- A/B: the recipients are shuffled and the first `round(n x abSplit / 100)` are variant A, the rest B, kept on the rows so a resume keeps them.

Events: `campaign.created`, `campaign.status_updated`, `campaign.contact_status_updated`, `campaign.contact_replied`,
`campaign.deleted`, `contact.opt_in` (`optedIn: false`, from a STOP).

## Build with AI

`POST /campaigns/ai-generate` (200, needs `camp.campaigns.create`): a brief in, the copy for a campaign out. Nothing is stored; the builder pastes the
answer into its own fields. The model list the picker shows is `GET /v2/ai/models`.

Request: `model`, `provider` (`openai`, `anthropic` or `gemini`), `businessName` (required, up to 191), and optional `product`, `goal`, `audience`,
`offer`, `ctaLabel`, `ctaUrl`, `tone` and `customPrompt` (up to 2,000).

Response: `{ campaign: { campaignName, message, footer, buttonText, buttonUrl, quickReplies[] }, model }`. Every field is cut to what the builder
accepts on submit: the name 60, the message 1,024, the footer 60, the button label 25, the address 1,024, three quick replies of 25.

The key is the workspace's own when its plan allows one, else the platform's. A call on the platform's key counts against the monthly token allowance, and
the tokens are written to the usage ledger either way. The key is never returned.

- 422 `CAMP_AI_NO_KEY`: neither the workspace nor the platform has an active key for the vendor.
- 422 `CAMP_AI_LIMIT_REACHED`: the monthly allowance on the platform's key is used up.
- 502 `CAMP_AI_PROVIDER_FAILED`: the vendor errored, timed out or answered nothing.
- 422 `CAMP_AI_BAD_JSON`: the answer was not a JSON object (a code fence around it is tolerated); `errors[0].message` carries the first 600 characters.

## Run

| Method and path                | What it does                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /campaigns/:id/cancel`   | `cancelled`: the run stops at its next recipient                                                                           |
| `POST /campaigns/:id/resume`   | `running`: a worker goes on with the unsent recipients                                                                     |
| `POST /campaigns/:id/send-now` | The schedule becomes now (in the campaign's zone) and the run starts                                                       |
| `POST /campaigns/:id/resend`   | Body `{ scope: failed (default) \| all \| selected, contactIds }`. 422 `CAMP_NOT_RESENDABLE`, 422 `CAMP_NOTHING_TO_RESEND` |
| `DELETE /campaigns/:id`        | The campaign and its recipients, in any status. 204                                                                        |
| `POST /campaigns/bulk-delete`  | `{ ids[] }`: only campaigns of this workspace. `{ ids, message }`                                                          |
| `GET /campaigns/:id/export`    | The recipients as CSV, streamed, newest first; formulas are neutralised                                                    |

Resend resets only the targeted rows (status, sent time, message id, error, attempts) and recomputes the counters from the rest.
`now` campaigns start at once; the others go back to `scheduled`.

### What a run does

A worker job per campaign (`campaign` queue). In order: opted-out contacts are stamped `unsubscribed`; a second row for the same number
is `skipped`; then for each recipient the checks that stop the run (cancelled or paused, past the end date, outside the window, the
daily limit), the gap (none for official engines; the platform gap with 20 percent jitter, or a random one in the throttle range, for
the others; a batch pause every `batchSize`), the variant's content, merge, link tracking, billing, the send and its record.

- **Retries:** a refused send keeps the row `failed` with a next attempt at `60 s x 2^(n-1)` (at most an hour); after 3 attempts it is final. Meta's ecosystem throttle (131049) is tried twice, 6 h and 12 h apart.
- **End:** completed; or `scheduled` again for the closed window, tomorrow's quota or the retries; a recurring campaign moves to its next date with every recipient queued again.
- **End date:** the operator's `expiresAt`, else (not Baileys, not deliberately paced) 24 hours after the first send. Past it, what was not sent is failed ("auto-expired") and the campaign ends.
- A custom message needs an engine that can send one; the Cloud API cannot (Reference's rule), so those recipients fail for good with the reason.
- A flow campaign needs the flow runtime: until then its recipients fail with the reason (shim).

A sweeper (every 5 seconds, in the worker) starts due campaigns, schedules a stranded `running` campaign again, puts claims of a dead worker
back, and treats webhook-reported failures with no retry planned.

## Reports from the Node bridge and providers

Public routes under `/campaigns/node/*` (not in the API docs). Header `X-Node-Token` must equal `NODE_BRIDGE_TOKEN` (constant-time compare; with
none configured every call is refused). `update-status` (final stats; recounts from the rows then takes the status), `update-contact-status`
(a recipient's status as reported, with times, message id, error), `update-status-by-id` (forward only; unknown id is `matched: false`),
`track-response` (a reply), `unsubscribe` (a STOP: the row, the contact's workspace flag, `contact.opt_in` only on a real change) and `drain`.

`CampaignReceiptsService.handle(receipt)` (exported from `modules/campaigns`) is the same state machine for a provider webhook: it returns
`false` for a message that is not a campaign's, so the caller offers it to broadcasts next.

## Broadcast wizard (an addition beyond Reference)

The four-step "Create broadcast" screen (`/campaigns/wizard`) is a layer over the campaign model above: its draft is a `wpcampaigns` row in
status `draft` (marked `wizard` on the list), a launch turns it into a campaign, and a recurring broadcast is a series with one child campaign per
occurrence. Reference has no equivalent screen; the behaviours it builds on are TW-CAMP-003/004 (audience), 005 (template gate), 008 (schedule),
011/012 (the run and its retries) and TW-WALLET-013 (the launch gate). Inventory: TW-CAMP-029 to 035. Route base `/v2/broadcast-wizard`
(its own, so `campaigns/:id` can never shadow it). Every `POST` takes an `Idempotency-Key`; errors are problem+json with a stable `code`; the
request and response shapes are `broadcast-wizard.ts` and `recurrence.ts` in `@crm/contracts`.

`create`, `read` and `control` are the existing keys; the test send needs `camp.campaigns.test`.

| Method and path                                  | Key     | What it does                                                                                                             |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /templates`                                 | create  | Approved templates (not OTP, number connected) with `slots` (`body.1`, `header.1`, `button.0`), language and category    |
| `GET /audience-sources`                          | create  | `groups` and `segments` with `memberCount` (a segment's is its last stored count)                                        |
| `POST /audience/count`                           | create  | `{ audience }` to `matching`, `optedOut`, `invalidNumber`, `recipients`, `countries`, `approximate`, `invalidConditions` |
| `POST /drafts`, `GET /drafts/:id`                | create  | Start and read a draft. A draft takes whatever is filled in so far                                                       |
| `PUT /drafts/:id`                                | create  | Save with `rowVersion` (409 `ROW_VERSION_CONFLICT`; 409 `CAMP_WIZARD_LAUNCHED` once launched)                            |
| `POST /credit-check`                             | create  | `{ templateId, audience }` to balance, estimate by country, `sufficient`, `shortfallMinor`, `topupUrl`                   |
| `POST /variables/preview`                        | create  | The message resolved for up to 5 real contacts, `unmapped` slots and `empty` ones per contact                            |
| `POST /test-send`                                | test    | `{ draftId, recipients }`: up to ten E.164 numbers; per-number result                                                    |
| `GET /drafts/:id/test-sends`                     | test    | The test log with delivery and the wallet charge of each message                                                         |
| `POST /drafts/:id/launch`                        | create  | `{ rowVersion }`: now, scheduled or recurring, per the draft's `schedule`                                                |
| `GET /broadcasts`, `GET /broadcasts/:id`         | read    | One-off campaigns and series, newest first (cursor, `status` filter); detail with `runList` and the retry summary        |
| `POST /broadcasts/:id/pause`, `resume`, `cancel` | control | A scheduled or running broadcast, or a series (cancel also stops the runs it started)                                    |

### The audience

`audience = { groupIds, segmentIds, rules }`. A contact is in when it belongs to ANY chosen group or segment AND matches `rules` (the segments
rule tree: AND/OR, three levels, built-in fields, `custom.<key>` properties; with no group or segment, `rules` select from every contact; with
neither, nobody). Opted-out contacts and numbers that are not 8 to 15 digits are removed last and reported apart. The count and the launch use
the same function, so the number the person saw is the list written as recipients (at most 100,000 per broadcast).

```json
POST /v2/broadcast-wizard/audience/count
{ "audience": { "groupIds": ["..."], "segmentIds": [], "rules": { "type": "group", "combinator": "and",
    "children": [{ "type": "condition", "field": "countryCode", "operator": "equals", "value": "+91" }] } } }
-> { "matching": 412, "optedOut": 9, "invalidNumber": 3, "recipients": 400, "approximate": false,
     "countries": [{ "country": "IN", "count": 400 }], "invalidConditions": [] }
```

### Variables

`variables` maps each slot to `{ "kind": "field", "field": "first_name", "fallback": "there" }` (a contact column or custom property key as merge
tags name it; the fallback fills a contact with no value) or `{ "kind": "fixed", "text": "SALE50" }` (no braces). Every slot must be mapped to
launch (`CAMP_WIZARD_INCOMPLETE`, `errors[]` with `path: "variables.body.1"`, `message: "variable_unmapped"`). The send applies the mapping over the
template's own variables, per recipient, in the one message builder the run, a retry and a test send share.

### Credit check and the launch gate

`sufficient` is the wallet's own launch rule (`WalletGateService.assertCanLaunch`, the same call the launch makes), so the screen and the launch can
never disagree; the figures are for reading: `lines` price each destination country in the template's category (`RateCardService.priceFor`),
`chargeableMessages` is what is left after the plan's monthly allowance in plan mode. An insufficient wallet refuses the launch with 422
`WALLET_EMPTY` before any row is written, and also refuses a test send.

### Launch

`POST /drafts/:id/launch { "rowVersion": 3 }` re-checks every step (`wizardLaunchIssues`), the template and sender gates, the groups and segments, the
audience (422 `CAMP_NO_RECIPIENTS`) and the wallet, then in one transaction:

- `now`: the draft becomes a `running` campaign with its recipients, queued after the commit;
- `scheduled`: `scheduled` with the date and time read in the chosen zone (`run_at` is the instant; the sweeper fires on the date, time and zone);
- `recurring`: a `camp_series` row (rule, blueprint, `next_run_at`) and the draft row is consumed. The result's `id` is the series.

```json
-> 200 { "mode": "recurring", "id": "<series uuid>", "kind": "series", "status": "active",
         "firstRunAt": "2026-10-12T09:00:00.000Z", "recipients": 400, "message": "Recurring broadcast started." }
```

### Recurring broadcasts

The rule: `frequency` daily | weekly | monthly, `interval` (every N), `startDate`, `timeOfDay`, `timezone`, `weekdays` (0 is Sunday; weekly), `monthDay`
(monthly; a short month uses its last day), `ends` never | `{ on_date }` (inclusive) | `{ after: N }`. Dates are calendar dates and the time is the clock
of the zone, so 09:00 stays 09:00 across daylight saving (a time inside the spring-forward gap runs at the first instant after it; a time that happens
twice takes its first). The worker's planner (every 5 s, `SKIP LOCKED`, the series row locked) creates the child campaign of the occurrence that is due,
with the audience as it is then, and moves `next_index` and `next_run_at` along the rule; `(series, occurrence)` is unique, so it can run twice and make
one run. A run more than 6 hours late (an outage) is stepped over and counted in `occurrences_skipped`, never sent in a burst. A run the wallet cannot
cover, or with nobody to message, is recorded as a `failed` child with the reason in `wizard.launch.error` and the series goes on. After the last
occurrence the series is `ended`.

### Frequency-cap retries

With `retries = { enabled, endDate, timezone }` a message that fails with Meta's frequency capping (`131049`, "healthy ecosystem engagement") is sent
again exactly 24 hours after the first send, and every 24 hours after that, until the end date (the whole day counts, in `timezone`). Only that
failure: any other error ends the retries for that recipient, and a delivered message is never retried. The worker's retry job works from the
recipient rows in three safe passes: `arm` (a failed 131049 recipient of a retry-enabled campaign gets slot 1), `settle` (a retry that was accepted
becomes `recovered` once delivered, or is armed again on another 131049, or ends), `run` (due slots are claimed `scheduled` to `sending` by one worker,
logged in `camp_retry_attempts` with a unique `(recipient, attempt_no)` row BEFORE the provider is called, sent through the shared message builder,
and recorded). Slots sit on a grid anchored at the first send; a slot a long outage missed is skipped, so retries are never bunched or closer than a
day. A claim whose worker died with no attempt logged goes back; one with an attempt logged ends the retries (a message that may have gone out is
never resent). No extra cost: the wallet charges a message when its delivery is reported, once per provider message id, and a failed message is not
charged, so a retry is charged only if it is delivered. The 6 h / 12 h backoff of TW-CAMP-012 is not applied to a wizard campaign.

### Test send

`{ "draftId": "...", "recipients": "+919876543210,+14155550123" }`: the draft's template and variables resolved for the first messageable contact of
its audience, sent through the same sender port a run uses (link tracking off). Numbers must be E.164 (`+` then 8 to 15 digits), at most ten
(`CAMP_TEST_RECIPIENTS_INVALID`, `errors[].message` `invalid:<n>` or `too_many:10`). The wallet's launch rule is asked first (422 `WALLET_EMPTY`).
Each number gets a `camp_test_sends` row; the response is the per-number result (`sent`, or `failed` with the provider's code). Delivery arrives later
through the Cloud API webhook, which now also offers a report to campaigns and to test sends (`WabaReceiptRegistry`): the row moves to
`delivered`, `read` or `failed`, and `message.delivery_reported` makes the wallet charge it once. The send is done in the request, on purpose: one person,
at most ten messages, waiting for the answer.

### The sandbox (`CAMP_PROVIDER_MODE=fixture`)

Nothing here ever reaches Meta in a test or a demo: with `CAMP_PROVIDER_MODE=fixture` (refused in production) the Cloud API engine of the sender
registry is a sandbox behind the same `EngineSender` port. It decides from the recipient's number and the attempt: `...<d>049` is refused for frequency
capping on the first `d` sends (`1049`: the original fails, the first retry goes through; `2049`: also the first retry; `9049`: never), `...0000` is
undeliverable (131026, not retried), `...9999` is refused on the spot (131030), anything else is delivered. It reports afterwards through the same receipt
path a webhook takes (a delayed job on the campaign queue). Real Meta behaviour of these paths is not verified here.
