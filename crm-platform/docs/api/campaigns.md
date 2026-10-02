# Campaigns API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every `POST`. A campaign is addressed by its uuid;
so is every contact, group, tag, template, flow and recipient. The WaDesk reference is `/wa-campaigns`; the inventory is
[inventory/campaigns.md](../wadesk-port/inventory/campaigns.md).

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
(WaDesk switched its masking off).

A campaign: `{ id, name, type, status, provider, abTesting, scheduleType, sendDate, sendTime, timezone, repeatInterval, expiresAt,
templateId, templateName, counts { recipients, sent, delivered, read, replies, clicks, failed }, lastRunAt, completedAt, createdAt,
updatedAt, rowVersion }`. `clicks` is the greater of our click count and Meta's, never the sum.

## Create and edit

`POST /campaigns` (201, `{ campaign, message }`) and `PUT /campaigns/:id` (`{ campaign, message }`). The form:

- `name`, `type` (`text`, `template`, `button`, `flow`, `media`, `custom`), `senderKey` (`engine:uuid`; none leaves the workspace's default engine).
- `customMessage` (required for text, custom, button and media), `customMessageB`, `customHeader`, `customFooter`, `customButtons`,
  `customQuickReplies`, `variableMap`, `mediaUrl` (an image jpg, jpeg or png, a video mp4, or a document pdf, doc or docx; uploading waits on the storage service).
- `templateId`, `templateIdA`, `templateIdB`, `templateOverrides`, `templateOverridesB`, `flowId`, `flowIdB`, `useAttributes`, `trackingEnabled`.
- `abTesting`, `abSplit` (percent to A, 0 to 100).
- `scheduleType` (`now`, `scheduled`, `recurring`), `sendDate` (`YYYY-MM-DD`) and `sendTime` (`HH:mm`) required unless `now`,
  `timezone` (IANA), `repeatInterval` (`daily`, `weekly`, `monthly`, default weekly), `repeatUntil`, `expiresAt` (`YYYY-MM-DDTHH:mm`, read in `timezone`).
- Smart Delivery: `throttleMinSec`, `throttleMaxSec` (0 to 3600, max at least min), `batchSize` (1 to 10,000), `batchPauseMin` (0 to 1,440), `dailyLimit` (1 to 100,000), `windowStart`, `windowEnd` (`HH:mm`).
- The audience: `contactIds`, `groupIds`, `tagIds`, `manualNumbers`, `csvText` (max 5 MB of text).
- `status`: only `draft` is accepted (a draft may have an empty audience).

Rules, in WaDesk's order: plan flag and cap, validation, the end-date guard, the send guardrails, the audience, the template gate,
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
- A custom message needs an engine that can send one; the Cloud API cannot (WaDesk's rule), so those recipients fail for good with the reason.
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
