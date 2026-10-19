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
| TW-CAMP-042 | ADDITION. Share a wizard send across several numbers (TW-BCAST-006/014)     | implemented | P1       | L      |

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
- **028 SMS and email runners:** campaigns with provider `sms` or `email` run through their own transports. SMS: ported with the SMS channel (TW-SMS). Email: ported (`?channel=email`, `EmailCampaignRunner`; API in [docs/api/campaigns.md](../../api/campaigns.md#email-campaigns)). The sender is a connected mailbox (`email:<uuid>`); the builder hides the template picker, flow, A/B, attachment and pacing, and the Header becomes the Subject (max 150, falls back to the campaign name); recipients are contacts with an address (opted-out dropped, a repeated address mailed once, subject CR/LF stripped); the body is HTML-escaped plain text with a text part; plan flag `email_channel` (Reference `access_email`) and the monthly cap `email_monthly` (Reference `email_monthly_limit`); each send is mirrored into an email inbox thread; one lock per campaign; auto-end date, Pause and Cancel respected.

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

### TW-CAMP-036: follow-up steps after a campaign message (ADDITION)

- **Source:** the meeting's "Add a follow-up" (react to a reply or a read, start a flow, send several messages in sequence on conditions). Reference's campaign screens and code have no follow-up step, so there is nothing to compare; the behaviour below is the decision recorded here.
- **Builds on:** TW-CAMP-025 (a flow campaign starts a flow per recipient through `CampaignFlowStarter`), TW-CAMP-021 (delivery and read reports), TW-CAMP-034 (the worker pattern of claim, log before the provider, record).
- **Rules:** 0 to 3 steps on the guided draft, Cloud API numbers only. Each: trigger (replied, read, not replied, not read), wait (1 minute to 7 days), action (an approved template, or start a published flow). Step 1 is measured from the campaign message, later steps from the previous step's message. A watching trigger (replied, read) fires the moment the event happens and ends the chain when the time runs out; a waiting trigger (not replied, not read) fires after the wait if the event did not happen and ends the chain if it did. A step happens at most once per recipient; an opt-out, a lost consent, a failed message or an empty wallet ends the chain. A resend restarts it. A recurring series copies the steps to every run.
- **Acceptance:** Given a campaign with a "not read after 1 hour" step, when a recipient has not read the message after an hour, then the follow-up template is sent once and the log says `sent`; when they read it first, nothing is sent and the log says `skipped`. Given a "replied" step, when the contact writes in the inbox inside the watch time, then the step fires within a minute and the recipient's response is recorded; when no reply comes, the step lapses. A second step looks at whether the first step's message was read. A flow step starts the flow and sends no message. A follow-up message is charged by the wallet once delivered.
- **Tests:** `apps/api/test/e2e/campaigns/broadcast-wizard-follow-ups.e2e.spec.ts`, `apps/api/test/unit/campaigns/wizard-follow-up-rules.spec.ts`, and the web `follow-ups*` tests.
- **Not verified:** nothing was run against the real WhatsApp Cloud API; read reports come from Meta's webhook and are reported as the sandbox does not make them by itself.

### TW-CAMP-037: A/B auto-winner (ADDITION, pending)

- **Source:** the meeting's "ship A/B now, rebuild the auto-winner later". Reference has the A/B split (TW-CAMP-007) and per-variant results but no auto-winner either, so this is new behaviour, not built yet.
- **State today:** the split slider (`abSplit`, default 50) and per-variant results exist on the guided campaign and the classic builder. The campaign never picks a winner: both variants keep their fixed share for the whole send.
- **To decide before building:** the winning measure (read rate, reply rate, click rate), the test share and how long it runs before the rest is sent, what a tie does, whether the person confirms the winner, and whether it applies to a recurring series' every run.
- **Status:** pending (tracker `todo`).

### TW-CAMP-038: Build with AI in the guided wizard, and the picture (ADDITION)

- **Source:** the meeting's "Build with AI ... campaign AI message generation, with images and content, creating templates. Needs mapping." The classic builder had text generation (TW-CAMP-002/026) but a verified Meta number always opens the guided wizard, which had no AI button, so the feature looked unwired.
- **Mapping:** the wizard sends an approved **template**, never free text, so its "Build with AI" drafts a **template** (TW-TPL-016, `POST /v2/templates/ai-generate`), hands it to the template form for review, and the person picks it in the wizard once Meta approves it. The classic builder keeps the text generation and gains an optional **picture** (`POST /v2/campaigns/ai-image`, OpenAI image model, stored as a marketing upload and attached as the campaign's image).
- **Not built:** carousel drafts (TW-TPL-016's carousel mode), a picture as a template header example (Meta needs the file uploaded through the template media endpoint), image models of other vendors.
- **Tests:** `apps/api/test/e2e/campaigns/campaigns-ai-build.e2e.spec.ts`, `test/unit/campaigns/http-campaign-ai-image.adapter.spec.ts`, `test/unit/message-templates/template-ai-rules.spec.ts`, and the web tests of the modal, the wizard button and the picture option.
- **Not verified:** nothing was run against a real OpenAI, Anthropic or Gemini key, or Meta's review of an AI-written template.

### TW-CAMP-039: step icons, and one list of templates in both builders (ADDITION)

- **Source:** the meeting's "Step icons and the stepper disappeared, and templates do not show in some views." Reference's stepper is numbered dots; the icons are an addition.
- **Stepper:** both steppers (the classic builder's five steps, the guided wizard's four) show an icon for each step in the dot, a check once the step is done; the number stays for screen readers. The wizard's phone view shows the current step's icon too.
- **Templates:** the classic builder's pickers and the wizard's list now hold the same templates (approved, sendable now, not OTP, not SMS). The classic builder still narrows its list to the chosen number in the browser, and the wizard still lets the picked number send a template of another number of the same business (both are deliberate and tested: numbers of one Meta business share its templates). The empty state links to the new-template form on the chosen number (the classic builder's link to `/templates/create` went nowhere).
- **Tests:** `broadcast-wizard-templates.e2e.spec.ts`, the stepper tests of both builders, the step-1 tests.

### TW-CAMP-040: recurring broadcast with several templates in sequence (ADDITION)

- **Source:** the meeting's "recurring broadcast with multiple templates in sequence". Reference's recurring campaign repeats one template (one `template_id`), so this is new behaviour recorded here.
- **Rules:** the draft's own template is the first, up to 9 more follow, each with its own variable mapping; the runs of the series take them in turn and start again after the last (counted by the runs made, so a stepped-over occurrence does not use one up). Only a recurring schedule, and not with an A/B test. Each run's draft carries its own template and mapping. The status page shows how many templates a series sends and which one each run sent.
- **Acceptance:** Given a daily series with two extra templates, run 1 sends the first, run 2 the second, run 3 the third and run 4 the first again, each with its own mapping; a sequence on a non-recurring schedule, with an A/B test, with an empty entry or an unmapped placeholder is refused at launch.
- **Tests:** `apps/api/test/e2e/campaigns/broadcast-wizard-sequence.e2e.spec.ts` and the web sequence tests.
- **Not verified:** nothing was run against the real WhatsApp Cloud API.

### TW-CAMP-041: target previous sends in every audience (ADDITION)

- **Source:** the meeting's "target previous broadcast" audience option. Reference has it only in the Scheduled composer (recipients "queue": broadcasts, whole), reading the broadcasts table; the classic campaign builder and the guided wizard could not target it.
- **Rules:** a source "Previous sends" in the wizard's audience step, in the classic builder's recipients step and in the Scheduled composer; a send is a broadcast or a campaign (every run of a recurring broadcast is a campaign); up to 20; narrowed by an outcome (all, delivered, read, not read, replied, not replied, clicked, failed; a broadcast has no replies or clicks). It is a source of the union like a group, so opted-out and unusable numbers are left out and a contact counts once. The count the wizard shows and the recipients a launch writes come from the same function.
- **Acceptance:** Given a campaign sent to five people of whom one read it, one replied and one clicked, a new broadcast aimed at its "not read" outcome messages exactly the people who neither read nor replied; a send of another workspace reaches nobody; a broadcast cannot be narrowed by replies.
- **Tests:** `apps/api/test/e2e/campaigns/broadcast-wizard-previous-sends.e2e.spec.ts` and the web tests of the picker, the wizard step, the classic step and the composer.
- **Not done:** the Scheduled composer has no outcome filter (Reference parity); the classic edit form does not re-show the choice (its recipients are the resolved contacts).

### TW-CAMP-042: share one send across several numbers (ADDITION; carries TW-BCAST-006 and TW-BCAST-014 into the Campaign wizard and the classic builder)

- **Source:** Reference's broadcast composer let an admin tick several numbers and give each a share weight (TW-BCAST-006); the audience was split across them and every contact was messaged from one (TW-BCAST-014). `/broadcasts/create` now redirects to `/campaigns/create`, so that composer became unreachable and the guided wizard sent from one number only. This restores the behaviour inside the wizard; the old compose screen was deleted.
- **Rules:**
  1. Step 1 keeps the **Send from** select. With two or more connected numbers (Meta, Twilio or personal device numbers), a **Share this send across several numbers** option swaps it for a tick list: a share weight beside each ticked number and its live percentage. At least one number stays ticked; one tick is the ordinary single number.
  2. A missing, empty, 0 or negative weight counts as 1 (the server's rule, `senderWeight`); weights go up to 1000. Documented deviation: Reference's badge showed 0% for a ticked 0 while the server sent with weight 1; the wizard shows the share that will really be sent.
  3. The draft holds `senderKey` (the first number, the campaign's own) plus `senderKeys` (the whole list once more than one is ticked) and `senderShare`. A draft saved before this has neither and behaves as a single number.
  4. At launch the recipients (contact order) are cut into sequential slices by `splitSizes` (floor of each share, the leftover to the largest fractions, ties to the number picked first), so every contact is in exactly one slice and the sizes add up. Each recipient row stores its number (`wp_campaign_contacts.sender_provider`, `sender_device_id`); a single-number send writes null in both and behaves as before. Fewer contacts than numbers leaves some numbers with nobody.
  5. The Review step shows the same split (recipients and percent per number) before launch; the launch result stores it in `wizard.launch.split`.
  6. Every picked number must be connected (422 on the draft otherwise, path `senderKeys.<n>`); any engine the sender directory resolves can share a send except a mailbox, and a personal number needs the platform switch on. The template (and variant B, the sequence templates, the follow-up templates) must be sendable from every picked number: a template tied to one WhatsApp connection goes out only from Cloud API numbers of the same Meta account (`meta_json.waba_id`; personal and other engines are never held to an account), else 422 `CAMP_TEMPLATE_NOT_ALLOWED` with `errors[].path = senderKeys.<n>`, `message = template_not_on_sender`, nothing written, the draft stays editable.
  7. The run sends each number's recipients as its own lane, side by side: own sender, own sender lock, own pacing and warm-up; the campaign lock, the daily limit and the final state (completed, paused for the wallet, scheduled again) are the campaign's, decided once after all lanes. A number that cannot be opened fails only its own recipients (`Sender unavailable: ...`); if none can be opened the campaign fails like an ordinary one. A number another run is using is skipped for now and the campaign is scheduled again shortly.
  8. The wallet check is one check for the whole audience (the template's category is the same for every number). The 131049 retry and the follow-up steps send from the number the recipient was first sent from (falling back to the campaign's number when the row has none). The test send goes from the first number.
  9. A recurring broadcast splits every run the same way; a run whose numbers are gone or no longer fit the template is recorded as a refused run, like any other refusal.
- **Acceptance:** Given three connected numbers of one Meta account with shares 2/1/1 and eight contacts, the launch writes 4/2/2 recipients, each contact once, and the run sends each from the number on its row. Given one of the numbers belongs to another Meta account, the launch is refused with 422 and writes nothing. Given one number, nothing differs from before.
- **Tests:** `apps/api/test/e2e/campaigns/broadcast-wizard-shares.e2e.spec.ts`, `apps/api/test/unit/campaigns/sender-split.spec.ts`, the web `sender-share-picker.dom.test.tsx`, `builder/step-setup-share.dom.test.tsx` and the reducer tests in `wizard/lib/state.test.ts`.
- **Classic builder:** the same picker sits in Setup next to the **Send from** select (a mail or a flow campaign has none). `POST/PUT /campaigns` take `senderKeys` and `senderShare`; the create splits the recipients with the same rule and stores each recipient's number, an edit that changes the numbers cuts the recipients already on the campaign again, and `GET /campaigns/:id/config` returns the numbers (the campaign's own first) with weights equal to the recipients each was given. The run, resend and retry paths are the shared ones, so each recipient goes out from its own number.
- **Per-number breakdown:** `GET /v2/campaigns/:id` (`senders`) and `GET /v2/broadcast-wizard/broadcasts/:id` (`senders`, all runs of a series together) list recipients, sent, delivered and failed per number; empty for a send from one number, where the page shows nothing.
- **Not done:** the test send goes from the first number only. Not verified against the real WhatsApp Cloud API or a real personal-number session (the sandbox sender stands in for both engines).

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
