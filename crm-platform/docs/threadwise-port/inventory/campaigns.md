---
domain: campaigns
code: CAMP
title: WhatsApp campaigns (wa-campaigns: text, template and flow sends, A/B, pacing, retries, tracking)
threadwise_version: '1.7.0'
sources_read: 9
---

# WhatsApp campaigns (`/wa-campaigns`)

## Overview

A **campaign** is a bulk send from one connected sender (Unofficial/Baileys, Cloud API/WABA, Twilio; SMS and email variants run
through their own runners) of a custom message, an approved template, or a flow, to an audience built from contacts, groups,
tags, typed numbers and an uploaded CSV. It differs from a **broadcast** (BCAST: a template to a list, several senders) in what it
can carry (custom text, media, buttons, flows), in A/B testing, in recurring schedules, in durable per-recipient retries, in an
end date, and in the funnel it reports (sent, delivered, read, replied, clicked, opted out). Rows: `wpcampaigns` (one per
campaign) and `wp_campaign_contacts` (one per recipient and its whole delivery history).

Status life: `draft | scheduled | running | paused | completed | failed | cancelled`. A sweeper (driven by the Node heartbeat in
Reference) fires due scheduled and recurring campaigns, resumes campaigns stranded at `running`, and re-arms the retries. Recipient
status: `queued | pending | sent | delivered | read | responded | failed | unsubscribed | skipped`.

Actors: workspace owner/admin only (`workspace.role:admin`), plan feature `campaign`, plan cap `total_campaigns_limit` counted on an
increment-only ledger (delete and recreate does not reset it); the Node bridge (callbacks); Meta and Twilio status webhooks.

Reference code: `WaCampaignsController` (5,881 lines), `WpCampaign`, `WpCampaignContact`, `CampaignScheduleSweeper`,
`user/wa-campaigns/{index,create,edit,detail,_cards}.blade.php` and `user-wa-campaigns-{index,create,edit,detail}.js`. Routes:
`routes/web.php` prefix `wa-campaigns`; `routes/api.php` `wa-campaigns.node.*` (token header `X-Node-Token`).

Connects to: broadcasts (template picker, overrides panel, link tracker, pacing, receipt state machine, webhook and bell mappers),
contacts-attributes-tags (audience, tags, unsubscribe flag), message-templates, flow-runtime-engine (flow campaigns),
whatsapp-devices-baileys and whatsapp-cloud-api-waba (senders), wallet-message-billing (plan-first billing), scheduled-queue-warmer
(per-number governor), team-inbox-conversations (mirror), ai-keys-usage-admin (build with AI), plans-subscriptions-trials.

## Feature index

| Id          | Feature                                                                     | Status      | Priority | Effort |
| ----------- | --------------------------------------------------------------------------- | ----------- | -------- | ------ |
| TW-CAMP-001 | List page: status, type and range filters, search, tiles, health cards      | implemented | P0       | L      |
| TW-CAMP-002 | Builder data: senders, contacts, groups, tags with counts, templates, flows | implemented | P0       | M      |
| TW-CAMP-003 | Create: validation, audience resolution, recipient rows, A/B assignment     | implemented | P0       | XL     |
| TW-CAMP-004 | Audience inputs: contacts, groups, tags, typed numbers, CSV and sample CSV  | implemented | P0       | L      |
| TW-CAMP-005 | Template gate: approval, auth templates, Cloud v2 quality, media check      | implemented | P0       | M      |
| TW-CAMP-006 | Custom message: named to positional variables, buttons, media, guardrails   | implemented | P0       | M      |
| TW-CAMP-007 | A/B testing: split, variant B message, template, flow, own overrides        | implemented | P1       | M      |
| TW-CAMP-008 | Schedule: now, scheduled, recurring, timezone, end date, born-expired guard | implemented | P0       | M      |
| TW-CAMP-009 | Smart Delivery: throttle range, batch size and pause, daily limit, window   | implemented | P1       | M      |
| TW-CAMP-010 | Edit and update (draft, scheduled, paused only), recipient rebuild          | implemented | P0       | M      |
| TW-CAMP-011 | Sending loop: skips, duplicate-number guard, pacing, billing, send, record  | implemented | P0       | XL     |
| TW-CAMP-012 | Durable retries with backoff; Meta ecosystem throttle handling              | implemented | P0       | M      |
| TW-CAMP-013 | End date and auto-expiry; ending an expired campaign                        | implemented | P1       | M      |
| TW-CAMP-014 | Sweeper: fire due, resume stalled, reconcile stuck Meta blocks, recurring   | implemented | P0       | L      |
| TW-CAMP-015 | Click tracking inside text bodies and URL buttons                           | implemented | P1       | M      |
| TW-CAMP-016 | Cancel, resume, send now                                                    | implemented | P0       | S      |
| TW-CAMP-017 | Resend: scope failed, all or selected                                       | implemented | P0       | M      |
| TW-CAMP-018 | Delete and bulk delete                                                      | implemented | P0       | S      |
| TW-CAMP-019 | Detail page: KPIs, funnel, charts, tabs, preview, live refresh              | implemented | P0       | XL     |
| TW-CAMP-020 | Recipients CSV export                                                       | implemented | P1       | S      |
| TW-CAMP-021 | Node callbacks: campaign status, contact status, status by id, drain        | implemented | P0       | L      |
| TW-CAMP-022 | Replies and opt-outs: track response, unsubscribe (STOP)                    | implemented | P0       | M      |
| TW-CAMP-023 | Inbox mirror of campaign sends                                              | implemented | P1       | M      |
| TW-CAMP-024 | Webhook events and bell notifications                                       | implemented | P1       | S      |
| TW-CAMP-025 | Flow campaigns: one flow session per recipient                              | implemented | P1       | L      |
| TW-CAMP-026 | Build with AI: model list and message generation                            | implemented | P2       | M      |
| TW-CAMP-027 | Meta click sync (template analytics)                                        | implemented | P2       | M      |
| TW-CAMP-028 | SMS and email campaign runners                                              | implemented | P2       | L      |
| TW-CAMP-029 | ADDITION. Create-broadcast wizard: four steps, one autosaved draft, resume  | implemented | P1       | L      |
| TW-CAMP-030 | ADDITION. Wizard audience: groups, segments, condition builder, live count  | implemented | P1       | L      |
| TW-CAMP-031 | ADDITION. Wizard review: credit check and per-template variable mapping     | implemented | P1       | M      |
| TW-CAMP-032 | ADDITION. Wizard test send: E.164 list, logged, charged on delivery         | implemented | P1       | M      |
| TW-CAMP-033 | ADDITION. Wizard schedule: now, scheduled, recurring series with runs       | implemented | P1       | L      |
| TW-CAMP-034 | ADDITION. Frequency-cap (131049) retries every 24 h until an end date       | implemented | P1       | L      |
| TW-CAMP-035 | ADDITION. Wizard broadcasts: list, status, pause, resume, cancel            | implemented | P2       | M      |

## Features

### TW-CAMP-001: List page

- **Endpoint:** `GET wa-campaigns` (`?status=&type=&range=&q=&page=`, `partial=1` returns cards, stats and pagination as JSON).
- **Rules:**
  1. Opening the page runs the sweeper once (20 s lock) so a stalled campaign resumes without any cron.
  2. Listed: campaigns of the workspace whose `provider` is one of the workspace's enabled engines, plus `sms` and `email` when those are enabled. Newest first, 12 a page.
  3. Status filter: `all`, `recently_created`/`recently_updated` (last 7 days), or an exact status. Type filter: `text` means `text, custom, media, button`; `template`; `flow`. Range: `7d`, `30d`, `90d`. Search matches the name (decrypted).
  4. Counters on each campaign and on the tiles come from one grouped query over the recipient log, not from the row's own columns (`sent`, `delivered`, `read`, `responded`, `clicked`), and `reconcileStatus` finishes a campaign whose recipients are all resolved.
  5. Sidebar: type counts, status counts (all, recently created, recently updated, scheduled, running, completed, failed). Tiles: total, queued, running, sent, failed, sent/delivered/read/failed totals, processing. Delivery health (average delivery rate, campaigns with more than 5 failures, healthy or warning). Queue health (template approval rate over the workspace's library, devices ready as connected/total across enabled engines, retry backlog = sum of failed).
- **Source refs:** `index`, `_cards.blade.php`, `user-wa-campaigns-index.js`.

### TW-CAMP-002: Builder data

- **Endpoint:** `GET wa-campaigns/create` (`?channel=sms|email` scopes the sender picker to that channel).
- **Rules:** connected senders only (composite `engine:id` keys, a number on both WABA and Baileys shows once, WABA preferred), contacts, groups with member counts, tags with counts (union of contact tags, and tagged conversations mapped to their contact by id or phone hash), live templates, flows, `requiresApprovedTemplates` (true when the active engine is WABA).
- **Source refs:** `create`, `contactIdsByTag`, `requiresApprovedTemplates`.

### TW-CAMP-003: Create

- **Endpoint:** `POST wa-campaigns` (JSON or form). Returns `{ ok, message, campaign, redirect }` or 422 `{ ok:false, message, errors }`.
- **Rules:**
  1. Order of refusals: plan feature `campaign`, plan cap, validation, expiry guard, guardrails, template gate, variant B ownership, then the write.
  2. Fields: `campaign_name` (max 191), `sender` (`engine:id`) or legacy `device_id`, `campaign_type` in `text, template, button, flow, media, custom`, `custom_message` required for text, custom, button and media, `schedule_type` in `now, scheduled, recurring`, plus the fields of 004 to 009.
  3. A bare `device_id` pins the provider to Baileys. A picked sender sets `device_id` and `provider` together. With neither, the provider defaults to the workspace's engine.
  4. Twilio and WABA custom sends drop buttons and quick replies.
  5. Status is the posted one or `running` for `now`, else `scheduled`. `total_recipients` is the audience size. The creator is recorded. Timezone defaults to the workspace's, then the app's.
  6. One recipient row per contact (status `queued`, variant when A/B), inserted in chunks of 1,000. `campaign_created` webhook.
  7. `now` dispatches at once (after the response); scheduled and recurring wait for the sweeper. Messages: "Campaign launched.", "Recurring campaign saved.", "Campaign scheduled."
- **Source refs:** `store`, `rejectForm`.

### TW-CAMP-004: Audience inputs

- **Rules:** explicit contact ids are filtered to the workspace (foreign ids dropped). Groups expand through each contact's group list. Tags expand through the union above, tags of another workspace ignored. Typed numbers split on whitespace, comma or semicolon. A CSV (max 5 MB, csv or txt) has an optional header (`name`, `phone`, `mobile`, `number`, `contact`); the phone column is found by header or is the first; every other column becomes a contact attribute (raw and snake_case). Numbers keep digits only and need 8 or more. Each typed or CSV number becomes a contact (found by phone hash, or created named from the CSV or "Recipient · last 4"); extra CSV columns are merged into its custom attributes. The audience is the unique union.
- **Sample CSV:** `GET wa-campaigns/sample-csv` downloads `campaign-recipients-sample.csv` with `name,country_code,phone` and two rows.
- **Source refs:** `store`, `parseManualNumbers`, `parseCsvNumbers`, `sampleCsv`.

### TW-CAMP-005: Template gate

- **Rules:** a template must belong to the workspace ("Template not found."). When the active engine is WABA it must be approved or public. Authentication (OTP) templates are refused (each recipient needs its own code). With Cloud templates v2 on and a Meta id: Meta status APPROVED, not paused, quality at or above the floor (UNKNOWN is allowed), and header media on a public https address (not a private or reserved host, not `.local`, `.test`, `.internal`, `.localhost`).
- **Source refs:** `store`, `mediaUrlReachableForMeta`.

### TW-CAMP-006: Custom message

- **Rules:** named tokens (`{{order_id}}`) are rewritten to positional (`{{1}}`) in order of first appearance with a slot-to-key map stored beside the body; a body with no named token is stored as sent, with the map it came with. One media only (image jpg/jpeg/png up to 2 MB, video mp4 up to 16 MB, document pdf/doc/docx up to 16 MB), first non-empty wins, stored under `campaign-media`. Header and footer max 255. The body is screened once by the send guardrails (monitor logs, enforce refuses).
- **Body resolution per recipient:** body from the template or `custom_message`; sender business name for `company_name`, `business_name`, `sender_name`, `brand_name`; workspace attributes; then the contact's standard fields and custom attributes by tolerant name (`{{First Name}}`); then positional slots through the variable map and the send-time overrides; a final sweep never lets a raw `{{x}}` out (template example, "there" for name slots, else removed, and the punctuation tidied).
- **Source refs:** `normalizeCustomMessage`, `resolveCampaignBody`, `store`.

### TW-CAMP-007: A/B testing

- **Rules:** `ab_testing`, `ab_split` 0 to 100 (percent to A). At create the recipients are shuffled and the first `round(n x split / 100)` are variant A, the rest B, persisted on the row so a resume keeps it. Variant B changes: for templates `template_id_b` (own buttons, header, media, carousel), for custom the body `custom_message_b` (media and buttons shared). Flow campaigns use `flow_id_b`. Variant B carries its own overrides (`template_overrides_b`); when B reuses A's template A's overrides apply; otherwise none rather than A's. A variant B template or flow of another workspace is refused.
- **Source refs:** `store`, `runCampaignNowPaced`.

### TW-CAMP-008: Schedule

- **Rules:** `scheduled` needs `send_date` and `send_time` read in the campaign timezone (an IANA name). `recurring` adds `repeat_interval` in `daily, weekly, monthly` (default weekly) and `repeat_until`; the next date is computed in the campaign's own timezone so the wall-clock hour survives daylight saving, monthly without overflow, and none after `repeat_until`. `expires_at` is the optional hard end date (read in the timezone, stored UTC); for scheduled and recurring it must be after the send date ("The auto-end date must be after the send date, otherwise the campaign would expire before it ever sends.").
- **Source refs:** `assertExpiryAfterSend`, `resolveCampaignExpiry`, `WpCampaign::dueAtUtc`, `advanceRecurring`.

### TW-CAMP-009: Smart Delivery

- **Rules:** `throttle_min_sec` and `throttle_max_sec` (0 to 3600, max at or above min; both set draws a fresh random gap per recipient), `batch_size` (1 to 10,000) and `batch_pause_min` (0 to 1,440), `daily_limit` (1 to 100,000), `window_start` and `window_end` as `HH:MM`. Blank means the platform default (`msg_gap` 3 s with 20 percent jitter, `enable_batches`, `batches_gap` 50, `bw_msg_gap` 5 min).
- **Engine rule:** official engines (WABA, Twilio) use no gap and no batch pause (Meta and Twilio self-limit); a per-campaign throttle and a warming number's gap win for every engine.

### TW-CAMP-010: Edit and update

- **Endpoints:** `GET wa-campaigns/{id}/edit`, `PUT wa-campaigns/{id}`.
- **Rules:** only `draft`, `paused` and `scheduled` campaigns ("Only draft, scheduled or paused campaigns can be edited." / "This campaign can no longer be edited."). Same validation as create. Overrides are touched only when submitted; an empty value clears. The attachment is replaced only when a new file arrives (the other media columns are cleared). When the form carries `recipients` or `groups` and the result is not empty, the recipient rows are deleted and rebuilt and the total recalculated. Changing the sender re-routes the engine.
- **Source refs:** `edit`, `update`.

### TW-CAMP-011: Sending loop (one run)

- **Rules, in order:**
  1. SMS and email campaigns go to their own runners. Flow campaigns go to the flow dispatcher (025).
  2. Contacts that opted out are dropped and their rows stamped `unsubscribed` (flag set) so the run can complete. One contact per normalized phone: duplicates are stamped `skipped` ("duplicate number, already sent this run"), not failed.
  3. Per recipient, skip when already `sent`, `delivered`, `read` or `responded`; when attempts reached the cap; when the next attempt time is still ahead. Stop (re-arm) outside the window, at the daily limit, or when the warming number's budget or hours say so. Stop when the operator cancelled or paused (re-read each time) or the end date passed.
  4. Gap before every recipient after the first (see 009), then the variant picks content. No mobile: permanent failure "No mobile number on contact". Empty body after resolution: permanent failure.
  5. Click tracking wraps links in text (015). Billing is plan-first: free under the plan's monthly messages, one wallet credit after (bulk marketing rate); plan cap reached and wallet empty is a permanent failure "Plan cap reached, top up wallet to keep sending".
  6. Send on the chosen engine (Cloud API template through the template sender when approved; otherwise the engine's plain send with buttons, footer, header, carousel and media). Record `sent` with the provider message id and time, or the failure (012).
  7. Per-run wall-clock budget of 20 seconds in Reference (an artifact of PHP); the port runs as a queue job with no such limit but keeps the same stop and re-arm reasons.
- **Source refs:** `runCampaignNowPaced`, `drainWabaTemplateParallel` (parallel Cloud drain, at most Meta's ceiling), `recordPermanentFailure`.

### TW-CAMP-012: Retries

- **Rules:** `campaign_retry_attempts` (default 3), `campaign_retry_backoff_sec` (default 60). A transient failure keeps the row `failed` with `send_attempts + 1` and a next attempt at `base x 2^(n-1)` capped at 1 hour; only at the cap does it count toward `failed_count`. Meta's "healthy ecosystem" throttle (131049) is capped at 2 attempts and spaced 6 h then 12 h (cap 24 h), then stamped at the global cap so no sweep re-pokes it. Permanent failures are stamped at the cap at once.
- **Source refs:** `recordSendFailure`, `recordPermanentFailure`.

### TW-CAMP-013: End date and auto-expiry

- **Rules:** deadline = the operator's `expires_at`; else, when `campaign_auto_expiry_enabled` (default on) and the engine is not Baileys and the campaign is not deliberately paced (recurring, a daily limit, or a window), the first send plus `campaign_default_expiry_hours` (default 24). Past it, every recipient not sent or unsubscribed becomes `failed` ("Not sent, campaign ended after its Nh send window (auto-expired)"), counters are recomputed from the rows, and the campaign becomes `completed` (or `failed` when nothing was sent and some failed).

### TW-CAMP-014: Sweeper

- **Rules:** every pass (locked 25 s): resume campaigns stuck at `running` for more than 45 s that still have queued or retryable rows (back to `scheduled`, due now); once every 10 min, rows `failed` with attempts below the cap and no next attempt (webhook-reported failures): 131049 stays resendable, everything else is stamped terminal; then fire up to 25 `scheduled` or `recurring` campaigns whose date is within a day and which are due (send date and time in their timezone). A fired campaign is `running` with `last_run_at`; one-shot loads only unfinished recipients; recurring loads everyone, runs, then advances the date and resets every row to `queued`, attempts 0.
- **Drain endpoint:** `POST api/campaigns/drain` runs one pass and answers `{ ok, campaigns_fired, campaigns_active }`.

### TW-CAMP-015: Click tracking

- **Rules:** links in a text body and URL buttons are wrapped into the recipient's short link (per campaign, contact and phone) unless tracking is off, the link is `tel:` or `mailto:` or already ours. A tap sets the row's `clicked`, `clicked_at`, `click_count`; `clicked_count` is the number of clicked rows. The tile shows the greater of that and Meta's click count (027).

### TW-CAMP-016: Cancel, resume, send now

- **Endpoints:** `POST wa-campaigns/{id}/cancel`, `/resume`, `/send-now` (JSON `{ ok, message, status, id }`).
- **Rules:** cancel sets `cancelled`. Resume sets `running` (the sweeper picks it up). Send now sets `running`, send date and time to now, and dispatches the recipient rows through the same path as create.

### TW-CAMP-017: Resend

- **Endpoint:** `POST wa-campaigns/{id}/resend` with `scope` (`failed` default, `all`, `selected` with `contact_ids`).
- **Rules:** only `completed`, `failed`, `cancelled` ("Only completed, failed or cancelled campaigns can be resent."). Targets are reset to `queued` and lose their sent time, message id and error; others keep their history. Counters are recomputed from the rows, `completed_at` cleared. `now` campaigns run at once for the targets only; others go back to `scheduled`. Nothing to resend is 422 ("Nothing to resend, no failed recipients in this campaign." / "no matching recipients." / "Pick at least one recipient to resend to."). Messages: "Resending to N failed recipient(s).", "... selected ...", "Resending to all N recipient(s)."

### TW-CAMP-018: Delete

- **Endpoints:** `DELETE wa-campaigns/{id}`, `POST wa-campaigns/bulk-delete` (`ids[]`).
- **Rules:** the recipient rows go with the campaign, in any status. Bulk delete keeps only ids of the workspace and says "Deleted N campaign(s)."

### TW-CAMP-019: Detail page

- **Endpoint:** `GET wa-campaigns/{id}` (`?partial=1` or JSON for the 15 s refresh: status, stats, recent failures, failure summary).
- **Rules:** aggregates are recomputed from the recipient log on every open. Stats: recipients, sent, delivered, read, replies, clicks (greater of ours and Meta's), failed, with percentages (delivered of recipients, read of delivered, replies, clicks and failed of recipients). Page parts: header, timeline, message log (search, own paginator), replies, funnel, hourly heatmap, segments, engagement and button rows, charts (grouped queries over the log), preview (body, footer, header, buttons, template name and category), recipients table with totals, audience cleanup (uploaded, invalid, opt-out skipped, final list), failures (newest 50, the delivery-issue reason) with the resend-to-failed count taken from the rows, opt-outs tab and opt-in count.
- **Source refs:** `show`, `buildChartData`, `hydrateRecipientRows`.

### TW-CAMP-020: Export

- **Endpoint:** `GET wa-campaigns/{id}/export`. Streams `campaign-{id}-recipients-{date}.csv`: Recipient, Phone, Variant, Status, Clicked, Queued, Sent, Delivered, Read, Responded, Last event, Error, times in the campaign timezone, formula-injection neutralised (leading `=`, `+`, `-`, `@` gets a quote). Contacts are hydrated through the workspace only.

### TW-CAMP-021: Node callbacks

- **Endpoints (header `X-Node-Token`, constant-time compare, 403 otherwise):** `POST api/campaigns/update-status` (parent aggregate), `update-contact-status` (`campaign_id`, `contact_id`, `status` in `queued, pending, sent, delivered, read, failed, unsubscribed`, error, message id, variant, times), `update-status-by-id` (`message_id`, `status`, ratchets forward only: queued 0, pending 1, sent 2, delivered 3, read 4, failed 9; times set once), `drain` (014).
- **Rules:** the parent callback recounts from the rows (the log is the truth) and then sets the posted status. Contact status writes the row, settles billing (charge on delivered, refund on failed, idempotent per message id), mirrors into the inbox (023), emits `campaign_contact_status_updated`, recounts.
- **Recount:** sent = sent, delivered, read; failed; delivered = delivered, read; read; responded (a non-empty response); clicked.

### TW-CAMP-022: Replies and opt-outs

- **Endpoints:** `POST api/campaigns/track-response` (`campaign_id`, `contact_id`, response max 4,096, time) stores the response and time and emits `campaign_contact_replied`. `POST api/campaigns/unsubscribe` (`campaign_id`, `phone`) finds the contact by phone (full or last 10 digits) then the row by contact or phone, sets `unsubscribed`, `is_unsubscribed`, `unsubscribed_at` and status `unsubscribed`, flips the contact's workspace-level flag so other campaigns and broadcasts skip it, emits `contact_opt_in` (opted_in false, source stop_keyword) only on the transition, and recounts.

### TW-CAMP-023: Inbox mirror

- **Rules:** on `sent`, `delivered` or `read` the send is copied into the recipient's open conversation as an outbound message (template body resolved for that contact, buttons, template name, `source: campaign`, a source key `campaign:{id}:contact:{contactId}`); de-duplicated on the provider message id so three statuses make one bubble; an empty body posts nothing.

### TW-CAMP-024: Events

- `campaign_created`, `campaign_status_updated` (on every status change, with the counts and the previous status), `campaign_contact_status_updated`, `campaign_contact_replied`, `contact_opt_in`; bell notifications as BCAST's mappers.

### TW-CAMP-025 to 028

- **025 Flow campaigns:** each recipient gets a new flow session started by the Node bridge (`flow_id`, `flow_id_b` for B). Blocked on flow-runtime-engine.
- **026 Build with AI:** `GET wa-campaigns/api/ai-models` lists the active admin text models (not ElevenLabs), `POST wa-campaigns/api/ai-generate` writes a message. Depends on ai-keys-usage-admin.
- **027 Meta click sync:** at most every 15 minutes per campaign on the detail refresh, the template's button clicks from Meta template analytics fill `meta_clicked_count`. Depends on whatsapp-cloud-api-waba.
- **028 SMS and email runners:** campaigns with provider `sms` or `email` run through their own transports. Skipped on the owner's word (SMS and email are not ported).

## Additions beyond Reference: the Create broadcast wizard

Reference has one campaign builder (`/wa-campaigns/create`, one long form). The project owner asked for a simpler four-step "Create broadcast" screen in our own look
and feel for WhatsApp **template** broadcasts. It is an **addition**, not a replacement: the classic builder (TW-CAMP-002/003) is untouched and still the way to
send custom text, media, flows and A/B tests; the wizard is a second front end over the same tables and the same sender. Every id below is an addition
(`ADDITION`), mapped to the Reference behaviour it builds on. API: [docs/api/campaigns.md](../../api/campaigns.md#broadcast-wizard-an-addition-beyond-threadwise).

### TW-CAMP-029: the wizard and its draft (ADDITION)

- **Builds on:** TW-CAMP-003 (create), TW-CAMP-010 (a `draft` can be edited). Reference saves a draft only through the full form.
- **Rules:**
  1. Steps: 1 Name and template, 2 Audience, 3 Check and variables, 4 Test and send. Each step validates before Next with the shared `wizardStepIssues`; the server runs all four again at launch.
  2. One draft per wizard run: a `wpcampaigns` row in `draft` with `wizard.draft` JSON (name, template, audience, variables, schedule, retries, furthest step), created on the first change and autosaved with `rowVersion`. It is listed with the campaigns (`wizard: true`) and reopens at its step. A launched draft is read-only (409 `CAMP_WIZARD_LAUNCHED`).
  3. Step 1 offers only approved templates (the compose rule: Meta-approved on the Cloud engine, locally approved otherwise; not OTP; the number connected) with search, language and category filters and the shared WhatsApp preview.
- **Routes:** `/campaigns/wizard`, `/campaigns/wizard/:id`, `/v2/broadcast-wizard/*`. **Permission:** `camp.campaigns.create`.

### TW-CAMP-030: audience (ADDITION)

- **Builds on:** TW-CAMP-004 (audience inputs: groups, tags, numbers, CSV) and the segments engine (rules, counts). Typed numbers, CSV and tags stay in the classic builder.
- **Rules:** groups and segments (any of them) narrowed by an AND/OR condition tree (the segments rule schema, so the builder, the count and the send agree; new built-in field `countryCode`); rules alone select from all contacts; nothing picked selects nobody. Opted-out contacts and numbers that are not 8 to 15 digits are always skipped and counted apart. The count is debounced on the screen, bounded by a 3-second timeout (an estimate beyond it, flagged `approximate`), and is the same function the launch writes recipients with (at most 100,000).

### TW-CAMP-031: review (ADDITION)

- **Builds on:** TW-WALLET-013 (launch gate), the Meta rate card (price by country and category), TW-CAMP-006 (variable resolution), TW-BCAST-017 (template variables).
- **Rules:** the credit check shows the balance, the estimate per destination country and category, whether the plan's monthly allowance covers part of it, and "insufficient balance" (decided by the wallet's own launch rule) with a top-up link; it blocks the launch. Each template placeholder (`header.n`, `body.n`, a link button's `button.i`) must be mapped to a contact field or property (with a fallback for contacts that lack it) or to fixed text; sample messages are resolved for real contacts; an unmapped placeholder blocks Next and the launch.

### TW-CAMP-032: test send (ADDITION)

- **Builds on:** the broadcasts send port (`EngineSender`), TW-WALLET-009..012 (charge on delivery).
- **Rules:** up to ten numbers, E.164, the draft's template and variables resolved for a real contact of the audience, tracking off, wallet precheck first, a log row per number (`camp_test_sends`), charged exactly once per provider message when delivery is reported. Needs `camp.campaigns.test`.

### TW-CAMP-033: schedule and recurring series (ADDITION)

- **Builds on:** TW-CAMP-008 (now, scheduled, recurring; zone; `advanceRecurring`). Reference's recurring campaign is one row that is re-queued, so past runs are lost, it repeats daily, weekly or monthly with a single end date, and a monthly run clamps with `addMonthNoOverflow`.
- **Differences (all additions):** the recurring broadcast is a **series** with one **child campaign per run** (own recipients, counters, history); rule with every N, weekly weekdays, monthly day, ends never / on a date / after N runs; the audience is re-evaluated at each run; a run more than 6 h stale is skipped, not sent in a burst; DST-safe wall-clock times. The scheduled one-off reads its date and time in the chosen zone (as TW-CAMP-008 requires) and snapshots its audience at launch.

### TW-CAMP-034: frequency-cap retries (ADDITION)

- **Builds on:** TW-CAMP-012 (Meta's "healthy ecosystem" throttle 131049 is tried twice, 6 h then 12 h later). The wizard replaces that for its own campaigns: retries are opt-in, exactly 24 h apart from the first send until an end date the person sets, only for 131049, with an attempt log. No extra cost (a failed message is not charged; a retry is charged only when delivered).

### TW-CAMP-035: wizard broadcasts (ADDITION)

- List, detail (runs, retry summary), pause, resume, cancel of a one-off or a series (`/campaigns/wizard/broadcasts/:id`). Cancel of a series also stops the runs it started.

### Reference comparison (live Reference, read-only)

See [parity/campaigns.md](../parity/campaigns.md#broadcast-wizard-addition): Reference's create flow, and what the wizard does the same or differently.

## Coverage

```json threadwise-coverage
{
  "domain": "campaigns",
  "routes_seen": ["wa-campaigns.*", "wa-campaigns.node.*"],
  "source_files": 9,
  "features": 35,
  "unread": ["WpCampaignContact", "user-wa-campaigns-*.js", "resources/views/user/wa-campaigns/*"]
}
```
