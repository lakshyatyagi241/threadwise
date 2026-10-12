---
domain: channel-sms
code: SMS
title: SMS channel (Twilio and MSG91 senders, broadcasts, campaigns, delivery reports) - send-only
threadwise_version: '1.7.0'
sources_read: 52
---

# SMS channel (send-only)

## Overview

A workspace connects one or more SMS senders. A sender is either a Twilio number (or alphanumeric id) or an MSG91 account (the
Indian, DLT-registered route). Senders are stored in the same per-workspace provider table the WhatsApp engines use
(`wa_provider_configs`, `provider = 'sms'`), so there is no SMS-specific sender table in Reference. Once a sender is connected,
the SMS option appears in two existing builders: the broadcast composer (a saved plain-text template, an audience of contacts,
groups and tags, send now or later) and the campaign builder (a free-text message, contacts, groups, tags, pasted or CSV
numbers, send now, later or recurring). Both hand the actual sending to a PHP runner that loops over the recipients, calls the
provider's HTTP API one message at a time and records a per-recipient result. Delivery reports from the provider come back to
one public callback URL and move the per-recipient result from sent to delivered or failed. A small "check a number" tool asks
Twilio Lookup whether a number is a mobile, a landline or invalid before money is spent texting it.

SMS is billed per 160-character segment by the provider, not per message, and one non-Latin character drops a message to 70
characters per segment. Reference therefore has a segment calculator (GSM-7 versus UCS-2). It meters usage against the plan's
monthly SMS cap, never the WhatsApp wallet, and keeps an optional per-sender "rate per segment" for spend reporting only.

**Scope decision (project owner): SMS in Threadwise is SEND-ONLY. There is no receive path.** Everything in Reference that
exists only to receive texts (the inbound webhook, inbox conversations and unread counts, STOP/START capture from replies,
automation on inbound texts, replying from the inbox) is not built. It is listed under "Dropped by owner decision" so it is
not mistaken for a gap. The delivery-status callback is NOT inbound mail: it only reports the fate of messages we sent, and it
is kept.

Plan gates: `access_sms` (the channel; boolean, default false), `sms_monthly_limit` (integer, 0 = unlimited). Platform switch:
system setting `sms_enabled` (default off) hides every entry point. The broadcast and campaign gates (`broadcast`,
`broadcast_limit`, `campaign`, `total_campaigns_limit`) and the unified `device_limit` also apply to SMS sends and senders.

Connects to: broadcasts and campaigns (composers and recipient tables, the SMS runners hook in here), message-templates (a
local `sms` template channel), contacts-attributes-tags (recipients, opt-out flag, merge variables), plans-subscriptions-trials
(feature flags and caps), platform-settings-branding-storage (`sms_enabled`, encryption), scheduled-queue-warmer (retry and
resume sweepers), wallet-message-billing (SMS is explicitly outside the wallet), whatsapp-cloud-api-waba (shared
`wa_provider_configs` table and device cap), team-inbox-conversations (Reference mirrors sends into it; dropped here).

## Feature index

| Id         | Feature                                                                      | Status      | Priority | Effort | Depends on                         |
| ---------- | ---------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------- |
| TW-SMS-001 | SMS hub page: connected numbers, status, lookup tool, setup guide            | implemented | P0       | M      | TW-SMS-002, TW-SMS-006, TW-SMS-025 |
| TW-SMS-002 | Connect an SMS sender (Twilio or MSG91 form, validation, upsert)             | implemented | P0       | M      | TW-SMS-003, TW-SMS-004, TW-SMS-025 |
| TW-SMS-003 | Twilio credential check and reuse of the workspace's Twilio keys             | implemented | P0       | S      | TW-SMS-002                         |
| TW-SMS-004 | MSG91 auth key check                                                         | implemented | P0       | S      | TW-SMS-002                         |
| TW-SMS-005 | India DLT fields: sender id, DLT template id, flow versus plain mode         | implemented | P0       | S      | TW-SMS-002, TW-SMS-012             |
| TW-SMS-006 | Activate or deactivate a sender                                              | implemented | P0       | S      | TW-SMS-002                         |
| TW-SMS-007 | Remove a sender                                                              | implemented | P0       | S      | TW-SMS-002                         |
| TW-SMS-008 | Number lookup: mobile, landline or invalid (Twilio Lookup)                   | implemented | P1       | M      | TW-SMS-002                         |
| TW-SMS-009 | Segment and encoding calculation (GSM-7 versus UCS-2)                        | partial     | P0       | S      | none                               |
| TW-SMS-010 | Provider seam: sendable check, phone normalisation, never-throw contract     | implemented | P0       | M      | TW-SMS-002                         |
| TW-SMS-011 | Send one SMS through Twilio                                                  | implemented | P0       | M      | TW-SMS-010                         |
| TW-SMS-012 | Send one SMS through MSG91 (DLT flow route or plain route)                   | implemented | P0       | M      | TW-SMS-010, TW-SMS-005             |
| TW-SMS-013 | Provider error translation into operator messages                            | implemented | P1       | S      | TW-SMS-011, TW-SMS-012             |
| TW-SMS-014 | Merge variables ({{token}}) in SMS bodies                                    | partial     | P0       | M      | contacts-attributes-tags           |
| TW-SMS-015 | SMS templates: local plain-text messages                                     | implemented | P0       | S      | message-templates                  |
| TW-SMS-016 | SMS broadcast: chooser card, composer, audience, sender fan-out              | implemented | P0       | M      | TW-SMS-015, TW-SMS-030             |
| TW-SMS-017 | SMS broadcast runner: sequential send, counters, status                      | implemented | P0       | L      | TW-SMS-016, TW-SMS-010             |
| TW-SMS-018 | SMS campaign builder: chooser card, fields kept and fields ignored           | partial     | P0       | M      | TW-SMS-030                         |
| TW-SMS-019 | SMS campaign runner: sequential send, per-recipient rows, KPI recompute      | implemented | P0       | L      | TW-SMS-018, TW-SMS-010             |
| TW-SMS-020 | Scheduling and recurrence for SMS sends                                      | partial     | P0       | M      | TW-SMS-017, TW-SMS-019             |
| TW-SMS-021 | Retries and resume: broadcast sweeper, manual retry, stalled campaign rescue | partial     | P1       | M      | TW-SMS-017, TW-SMS-019             |
| TW-SMS-022 | Delivery status callback and status mapping (Twilio and MSG91 DLR)           | implemented | P0       | M      | TW-SMS-029                         |
| TW-SMS-023 | Delivery roll-up into campaign analytics (and the broadcast gap)             | partial     | P1       | S      | TW-SMS-022                         |
| TW-SMS-024 | Opt-out suppression on the send side                                         | partial     | P0       | S      | contacts-attributes-tags           |
| TW-SMS-025 | Plan gate `access_sms` and the platform switch `sms_enabled`                 | implemented | P0       | S      | plans-subscriptions-trials         |
| TW-SMS-026 | Monthly SMS quota (`sms_monthly_limit`)                                      | implemented | P0       | S      | TW-SMS-029                         |
| TW-SMS-027 | Rate per segment, cost figure and the no-wallet rule                         | partial     | P2       | S      | TW-SMS-009                         |
| TW-SMS-028 | Entry points: menu, More tile, add-channel card, Channels table rows         | implemented | P1       | S      | TW-SMS-025                         |
| TW-SMS-029 | Outbound SMS record (what Reference stores per sent message)                 | partial     | P0       | M      | TW-SMS-017, TW-SMS-019             |
| TW-SMS-030 | Sender resolution at send time and in the pickers                            | implemented | P0       | S      | TW-SMS-002                         |

Dropped by owner decision (send-only): see the section of that name below (TW-SMS-D01 to TW-SMS-D08). They are not part of the
build and carry no acceptance criteria.

## Features

### TW-SMS-001 — SMS hub page: connected numbers, status, lookup tool, setup guide

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-002, TW-SMS-006, TW-SMS-025
- **Summary:** `/sms` is the one screen where a workspace sees its SMS senders, connects another, switches one off, removes one and checks a number. It also carries the setup guide for both providers.
- **Actors & access:** workspace members (no `workspace.role` guard) on a plan with `access_sms`. On a plan without it the page still renders (a GET), with the global paywall slid over it; every action on the page is refused (see TW-SMS-025). The menu entry is hidden unless `sms_enabled` is on, but the route itself is not blocked by that switch.
- **UX & screens:** `resources/views/user/sms/index.blade.php` (page key `user-sms`), script `resources/js/charts/user-sms.js`. Two columns.
  - Left sidebar: a card "SMS" with the caption "Twilio · MSG91" and a status pill: "N number(s) active" (count of senders whose status is connected; a plural-aware string) or "Not connected". A "How it works" list of four steps and a "Related" list linking to Unified Inbox, Campaigns and Channels. QUIRK: step 2 ("paste the two webhook URLs") and step 3 ("inbound texts land in the same team inbox") describe the dropped receive path; rewrite for a send-only product (steps: connect a sender, paste the delivery-report URL for MSG91, send broadcasts and campaigns, billed to the plan's SMS quota and never the WhatsApp wallet).
  - Main: (a) a "Remember: paste these into your provider" card with two copyable URLs, the inbound webhook and the delivery-status callback. Keep only the delivery-status URL (TW-SMS-022); the inbound URL is dropped (TW-SMS-D08). The copy button writes the URL to the clipboard and its label flips to "Copied". (b) "Connected numbers": heading, "N total", an empty state ("No SMS number connected yet." with a "Connect your first number" button that jumps to the form) or a card grid (1, 2 or 3 columns by width). (c) "Check a number before you text it" (TW-SMS-008). (d) "Connect a number" (TW-SMS-002) with the sentence "Add as many as you need — several Twilio numbers and MSG91 senders can run at once." plus, when the workspace already has a Twilio WhatsApp connection, "You already have Twilio connected — leave the Account SID / Auth Token blank to reuse those keys." (e) A setup guide with three collapsible blocks: Twilio (global), MSG91 (India / DLT) and "Segments, cost & billing".
  - Each sender card shows: the number or sender text in monospace, a provider badge (MSG91 in amber, Twilio in green), an Active or Inactive dot, a "Rate / segment" row ("<rate> <currency>" or an em dash), and for MSG91 only a "DLT sender" row and a "DLT template" row (value or em dash). Buttons: "Deactivate" or "Activate", and "Remove" (browser confirm "Remove this SMS number?").
  - Flash areas: a green status banner, a red error banner, and a red validation box titled "Couldn’t connect the SMS number:" listing every validation error.
  - Setup guide, Twilio points: copy the Account SID (starts "AC") and Auth Token from the console, an API Key ("SK...") will not work; buy an SMS-capable number or use the trial number; set the status callback URL; trial accounts only text verified numbers and refuse custom text. MSG91 points: Indian carriers filter foreign long codes; paste the MSG91 Auth Key in the token field; register a 6-letter DLT sender id and a DLT template on the DLT portal and paste both. Segments points: 160 characters in GSM-7, one emoji or non-Latin character drops the limit to 70 (UCS-2) and can triple the cost; the rate is for spend reporting only; metered by the plan's monthly SMS quota and never the WhatsApp wallet; an alphanumeric sender id is one-way. (Drop the Twilio "A message comes in" step and the "no replies" reason; keep the rest.)
- **Endpoints:**

| Method uri | Route name     | Controller@action           | Middleware                 | Request fields | Response                            |
| ---------- | -------------- | --------------------------- | -------------------------- | -------------- | ----------------------------------- |
| GET sms    | user.sms.index | SmsSettingsController@index | web, auth, plan:access_sms | none           | view with `senders` and `hasTwilio` |

- **Data:** reads `wa_provider_configs` where `workspace_id` = the user's current workspace and `provider = 'sms'`, ordered by id ascending (oldest first, no pagination). `hasTwilio` = the workspace has any `provider = 'twilio'` row (any status).
- **Rules & edge cases:**
  1. A user with no current workspace sees an empty list (workspace id 0).
  2. The pill counts only status `connected`; an inactive sender is listed but not counted.
  3. Secrets are never rendered: only the number, provider, label values from the non-secret JSON and the rate are shown.
  4. The page does not poll or use realtime.
- **Async & events:** none.
- **External systems:** none on load.
- **Settings:** `sms_enabled` (menu only), plan `access_sms`.
- **Acceptance criteria:**
  - Given a workspace with one Twilio and one MSG91 sender, When `/sms` opens, Then both appear oldest first, the MSG91 card shows its DLT sender and DLT template rows and the Twilio card does not, and the pill reads "2 numbers active".
  - Given a workspace with no senders, When `/sms` opens, Then the empty state and the connect form show and the pill reads "Not connected".
  - Given a plan without `access_sms`, When the page is requested, Then it renders under the paywall and no action on it succeeds.
  - Given a deactivated sender, When listed, Then it shows "Inactive", is not counted in the pill and offers "Activate".
- **Source refs:** `app/Http/Controllers/Sms/SmsSettingsController.php`, `resources/views/user/sms/index.blade.php`, `resources/js/charts/user-sms.js`, `routes/sms.php`.
- **Port notes:** home `apps/web/src/features/channel-sms/` and `apps/web/src/app/(app)/(channel-sms)/`; API `apps/api/src/modules/channel-sms/`. Add real permission keys (Reference has none). No inbound URL on screen.

### TW-SMS-002 — Connect an SMS sender (Twilio or MSG91 form, validation, upsert)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-003, TW-SMS-004, TW-SMS-025
- **Summary:** The operator picks a provider, enters the sending number or id and the credentials, and we verify them with the provider before saving. The same number can be re-submitted to update it. Several senders per workspace are allowed.
- **Actors & access:** workspace members; plan feature `access_sms` is enforced inline in the action (the route sits in the shared `/connect/wa-store/*` group so route middleware cannot be used). The form is reachable from `/sms` and `/devices`.
- **UX & screens:** `resources/views/user/devices/_sms_form.blade.php`, a plain POST form (no JavaScript), with a hidden `return_to` (default `/sms`). Fields:
  - "SMS provider" (required) select: "Twilio (global)" = `twilio` (default), "MSG91 (India / DLT)" = `msg91`. Hint: "Twilio for most countries; MSG91 for reliable delivery into India."
  - "From number / Sender ID" (required, max 32, monospace, placeholder `+17372508034`). Hint: a +E.164 SMS number (Twilio) or the registered sender (MSG91); an alphanumeric sender is one-way, no replies.
  - Credentials block: "Twilio Account SID" (max 64, placeholder `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`; hint: Twilio only, leave blank to reuse the keys already connected for WhatsApp) and "Auth Token / MSG91 Auth Key" (password input, max 255; hint: encrypted at rest, blank reuses existing Twilio keys).
  - A collapsible "MSG91 / India (DLT) options": "DLT Sender ID" (max 16, hint "MSG91 only. Your 6-letter DLT-registered sender.") and "DLT Template ID" (max 64, hint "MSG91 only. The approved DLT template id used for Indian delivery."), then a grey box listing the MSG91 panel webhook URLs. Keep only the DLR URL there (the Inbound row is dropped).
  - "Rate per segment" (optional number, step 0.0001, min 0, placeholder 0.0075; hint "For your SMS spend reporting only — never billed to the WhatsApp wallet.") and "Currency" (max 8, default "USD").
  - Submit button "Verify + connect SMS". Errors under the form for `account_sid` and `from_number`.
- **Endpoints:**

| Method uri                | Route name                | Controller@action           | Middleware                    | Request fields                                                                                                        | Response                                                  |
| ------------------------- | ------------------------- | --------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| POST connect/wa-store/sms | user.connect.wa-store.sms | WaConnectController@saveSms | web, auth (plan check inline) | sms_provider, from_number, account_sid, auth_token, sender_id, dlt_template_id, rate_per_segment, currency, return_to | redirect to `return_to` or `/devices` with a flash status |

- **Data:** writes one `wa_provider_configs` row per (workspace, provider `sms`, `phone_number`). Columns: `workspace_id`; `provider = 'sms'`; `status = 'connected'`; `phone_number` = the From value as typed (trimmed, NOT encrypted, so it can be matched by digits); `display_label` = "SMS · MSG91" or "SMS · Twilio"; `connected_at` = now; `is_primary = false`; `credentials_json` (encrypted) = { account_sid, auth_token, from_number }; `meta_json` (plain JSON, merged over any existing value) = { sms_provider, sender_id, dlt_template_id, rate_per_segment (string or null), currency (upper-cased, default "USD") }.
- **Rules & edge cases:**
  1. Validation (Laravel messages are the default ones): `sms_provider` nullable, one of `twilio`, `msg91` (anything else: "The selected sms provider is invalid."); `from_number` required string max 32; `account_sid` nullable string max 64; `auth_token` nullable string max 255; `sender_id` nullable string max 16; `dlt_template_id` nullable string max 64; `rate_per_segment` nullable numeric min 0; `currency` nullable string max 8. A missing provider means `twilio`.
  2. The plan feature check runs before validation. A workspace without `access_sms` is refused with "This feature isn't available on your current plan. Upgrade to unlock it." and nothing is saved.
  3. No current workspace: error on `from_number` "Pick or create a workspace first." with the input kept.
  4. Credentials are trimmed, then verified with the provider (TW-SMS-003 / TW-SMS-004) BEFORE anything is stored. A failure goes back to the form with the provider's reason on the `account_sid` field and the input kept.
  5. Upsert key is (workspace, `sms`, From number exactly as typed after trimming). Re-submitting the same From updates that row (creds replaced, `meta_json` merged key by key, status set to connected again). A different From adds another sender. QUIRK: "+1 737..." and "17372508034" are two different keys.
  6. The unified device cap is checked only when the row is NEW: used = this user's WhatsApp devices in the workspace + all `waba`, `twilio` and `sms` provider rows of the workspace; the cap is `device_limit` (0 or null means unlimited). Over the cap: "You've reached your plan's limit of N devices. Upgrade your plan to add more, or delete an existing one to free up space."
  7. The sender is never made primary and never takes part in WhatsApp engine selection (it is not a WhatsApp engine and is not in the allowed send methods).
  8. `rate_per_segment` is stored as a string (blank stays null). The currency is upper-cased and defaults to USD when blank.
  9. Blank `sender_id` or `dlt_template_id` on a re-submit overwrites the stored value with an empty string (no "keep existing").
  10. The From value is not validated as a phone number or checked for SMS capability. An id containing any letter is treated as alphanumeric (TW-SMS-010).
  11. Redirect target: `return_to` is honoured only when it starts with `/` and not `//`; otherwise `/devices`. Success flash: "SMS number connected. You can start sending now."
  12. After saving, the workspace's engine cache is flushed (rebuild any sender-list cache).
  13. QUIRK (MSG91 key location): the verify step accepts the key from the token field, falling back to the SID field when the token is blank, but storage keeps the two fields as typed. A key pasted only into the SID field passes verification and is saved as a sender that is NOT sendable (token blank). Port: normalise to one stored key for MSG91.
  14. MSG91 ignores the From value when sending (TW-SMS-012); it is required and stored, and used as the row's identity and label, and a sendable sender needs a non-blank From.
- **Async & events:** none (synchronous verification call). Emit `sms.sender.connected` through the outbox in the port.
- **External systems:** Twilio Accounts API and MSG91 balance API for verification (see TW-SMS-003, TW-SMS-004).
- **Settings:** plan `access_sms`, plan `device_limit`.
- **Acceptance criteria:**
  - Given valid Twilio credentials and a From number, When submitted, Then a connected sender exists with encrypted credentials, the label "SMS · Twilio", the rate and currency, and the user lands on `/sms` with the success flash.
  - Given the same From number submitted again with a new rate, When saved, Then there is still one row and the rate is updated.
  - Given credentials the provider rejects, When submitted, Then nothing is saved and the reason shows on the form with the entered values kept.
  - Given a plan without `access_sms`, When submitted, Then it is refused with the plan message and nothing is saved.
  - Given a workspace at its device cap, When a new From number is submitted, Then it is refused with the limit message; Given the same From number as an existing sender, Then the update succeeds.
  - Given `sms_provider = telegram`, When submitted, Then "The selected sms provider is invalid." shows.
- **Source refs:** `app/Http/Controllers/WaConnectController.php` (`saveSms`), `resources/views/user/devices/_sms_form.blade.php`, `app/Models/WaProviderConfig.php`, `app/Services/Sms/SmsSender.php`, `app/Services/PlanLimitGuard.php`, `routes/web.php`.
- **Port notes:** no SMS table exists in this repo. Create `sms_senders` (RLS, composite org key; see Data model) instead of reusing a WhatsApp provider table, and keep the same `device_limit` accounting by counting SMS senders alongside the other channel numbers (read it from the plan service). Encrypt the secret fields with the app's crypto service. Verification runs through a provider adapter under `apps/api/src/infra/providers/channel-sms/` so tests use a fake. Reference has no permission keys here; add `sms.sender.manage`.

### TW-SMS-003 — Twilio credential check and reuse of the workspace's Twilio keys

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002
- **Summary:** Before a Twilio sender is saved, the Account SID and Auth Token are checked against Twilio. If either is left blank the workspace's existing Twilio (WhatsApp) credentials are borrowed.
- **Actors & access:** same as TW-SMS-002.
- **UX & screens:** error text appears under the form on the SID field.
- **Endpoints:** part of POST connect/wa-store/sms (TW-SMS-002).
- **Data:** reads the workspace's first `wa_provider_configs` row with `provider = 'twilio'` (any status, lowest id) and its decrypted `account_sid` and `auth_token`.
- **Rules & edge cases:**
  1. Reuse applies only when the provider is Twilio and the SID or the token (or both) is blank after trimming. Each blank field is filled from the existing Twilio row individually; a field the operator typed wins.
  2. Verify (Twilio): both values are required, otherwise "Account SID and Auth Token are both required."
  3. The SID must start with "AC". Otherwise: "That is not an Account SID. It must start with "AC" — an API Key starting "SK" will not work here. Copy the Account SID from the Twilio console home page."
  4. The check is an authenticated GET of `https://api.twilio.com/2010-04-01/Accounts/{sid}.json` with basic auth (SID, token), 12 s timeout. A 2xx passes.
  5. A non-2xx fails with "Twilio rejected those credentials: <Twilio's message, or HTTP <status>>". A network error fails with "Could not reach Twilio: <exception text>".
  6. Nothing is stored when the check fails.
  7. QUIRK: a non-AC SID is reported only when it is non-blank; with a blank SID and no existing Twilio connection the "both required" message shows first.
- **Async & events:** none.
- **External systems:** Twilio REST API. Auth: HTTP basic with the SID and token. No rate-limit handling.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace that already connected Twilio for WhatsApp, When the SID and token are left blank, Then the sender is saved with those credentials after they verify.
  - Given an SID starting with "SK", When submitted, Then the API-key message shows and nothing is saved.
  - Given wrong credentials, When submitted, Then "Twilio rejected those credentials: ..." shows with Twilio's reason.
  - Given Twilio is unreachable, When submitted, Then "Could not reach Twilio: ..." shows.
- **Source refs:** `app/Services/Sms/Transports/TwilioTransport.php` (`verify`), `app/Services/Sms/SmsClient.php` (`verify`), `app/Http/Controllers/WaConnectController.php`.
- **Port notes:** put the reuse behind the whatsapp provider-config service from the Twilio WhatsApp domain; if that domain's table is not yet present, ship the explicit-credentials path first and mark the reuse as `blocked on` that domain.

### TW-SMS-004 — MSG91 auth key check

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002
- **Summary:** An MSG91 sender is accepted only if the auth key authenticates against MSG91.
- **Actors & access:** same as TW-SMS-002.
- **UX & screens:** error text under the form on the SID field.
- **Endpoints:** part of POST connect/wa-store/sms.
- **Data:** none beyond the stored credentials.
- **Rules & edge cases:**
  1. The key is the token field, else the SID field (QUIRK in TW-SMS-002 rule 13). A blank key: "An MSG91 auth key is required."
  2. The check is a GET of `https://control.msg91.com/api/balance.php?type=4` with an `authkey` header and JSON accept, 12 s timeout (the cheapest authenticated read).
  3. A non-2xx fails with "MSG91 rejected that auth key (HTTP <status>)."
  4. MSG91 answers a wrong key with HTTP 200 and an error body, so a 2xx body that contains "error" or "invalid" (case-insensitive) fails with "MSG91 rejected that auth key."
  5. A network error: "Could not reach MSG91: <exception text>".
  6. The sender id and DLT template id are NOT checked against MSG91 or the DLT registry at connect time; a wrong one fails only at the first send (TW-SMS-013).
- **Async & events:** none.
- **External systems:** MSG91 control API. Auth: `authkey` header.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid auth key, When submitted, Then the sender is saved with the label "SMS · MSG91".
  - Given a key that gets HTTP 200 with an error body, When submitted, Then "MSG91 rejected that auth key." shows and nothing is saved.
  - Given a blank key, When submitted, Then "An MSG91 auth key is required." shows.
- **Source refs:** `app/Services/Sms/Transports/Msg91Transport.php` (`verify`), `app/Services/Sms/SmsClient.php`.
- **Port notes:** substring matching on the body is brittle; keep it as the documented behaviour but isolate it in the adapter so it can be tightened when a live MSG91 account is available (Reference's own comment says it was never verified against a live account).

### TW-SMS-005 — India DLT fields: sender id, DLT template id, flow versus plain mode

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002, TW-SMS-012
- **Summary:** For Indian delivery, an MSG91 sender carries the registered sender id (the "header") and an approved DLT template id. The presence of the template id decides whether MSG91 sends through its template ("flow") route or its free-text route.
- **Actors & access:** same as TW-SMS-002.
- **UX & screens:** inside the collapsible "MSG91 / India (DLT) options" in the connect form, and the "DLT sender" and "DLT template" rows on the MSG91 sender card. Setup guide text: register a 6-letter DLT sender id and your DLT template on the DLT portal, then paste both.
- **Endpoints:** part of POST connect/wa-store/sms.
- **Data:** `meta_json.sender_id` (string, max 16 by validation), `meta_json.dlt_template_id` (string, max 64). Both live ON THE SENDER; there is no per-template or per-message DLT field anywhere in Reference.
- **Rules & edge cases:**
  1. Mode is chosen per send: a non-blank DLT template id on the sender selects the flow route; blank selects the plain route (TW-SMS-012).
  2. One sender holds exactly one DLT template id. Every broadcast and campaign sent from that sender, whatever its text, goes through that one template with the whole personalised message passed as a variable. A workspace needing several approved templates must connect several senders (QUIRK; it is the only supported way).
  3. The sender id is length-limited to 16 characters on the server, but the hint, the placeholder and the MSG91 error text all say 6 letters. No server check enforces 6 letters or letters only.
  4. A DLT entity id (the principal entity id) is not a field in Reference. MSG91 resolves it from the account. Decision for the port (see Open questions): add an optional `dlt_entity_id` and a per-template DLT id, or keep Reference's model.
  5. The fields are only shown and used for the `msg91` provider; Twilio senders ignore them even if filled.
  6. Neither field is validated against the DLT portal; errors surface at send time as "MSG91 rejected the DLT template id..." or "MSG91 rejected the sender id..." (TW-SMS-013).
- **Async & events:** none.
- **External systems:** MSG91 and the Indian DLT registry (indirect).
- **Settings:** none.
- **Acceptance criteria:**
  - Given an MSG91 sender with a DLT template id, When a message is sent, Then the flow route is used and the DLT sender id is passed as the sender.
  - Given an MSG91 sender with no DLT template id, When a message is sent, Then the plain route is used (TW-SMS-012).
  - Given a Twilio sender with a stored DLT id, When it sends, Then the DLT id has no effect.
  - Given an 18-character sender id, When submitted, Then "The sender id field must not be greater than 16 characters." shows.
- **Source refs:** `app/Services/Sms/SmsSender.php`, `app/Services/Sms/Transports/Msg91Transport.php`, `resources/views/user/devices/_sms_form.blade.php`, `resources/views/user/sms/index.blade.php`, `app/Http/Controllers/WaConnectController.php`.
- **Port notes:** columns `sender_id varchar(16)` and `dlt_template_id varchar(64)` on `sms_senders`. If the owner approves an entity id, add `dlt_entity_id varchar(64)` as an additive column.

### TW-SMS-006 — Activate or deactivate a sender

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002
- **Summary:** A sender can be switched off without losing its credentials, and back on.
- **Actors & access:** workspace members on a plan with `access_sms`. A POST: on a plan without the feature the action is blocked (redirect back with "Your plan doesn't include sms. Upgrade to unlock this feature.", or a JSON 403 `plan_feature_disabled`).
- **UX & screens:** "Deactivate" / "Activate" button on each sender card; a green flash after.
- **Endpoints:**

| Method uri           | Route name      | Controller@action            | Middleware                 | Request fields | Response                                   |
| -------------------- | --------------- | ---------------------------- | -------------------------- | -------------- | ------------------------------------------ |
| POST sms/{id}/toggle | user.sms.toggle | SmsSettingsController@toggle | web, auth, plan:access_sms | none           | redirect back with a status or error flash |

- **Data:** flips `wa_provider_configs.status` between `connected` and `disconnected` for the row matching id, current workspace and `provider = 'sms'`.
- **Rules & edge cases:**
  1. `{id}` must be numeric (route constraint).
  2. A row not found in the workspace: error flash "SMS number not found."
  3. Flash on success: "SMS number activated." or "SMS number deactivated."
  4. An inactive sender is not offered in any sender picker and cannot send (TW-SMS-010, TW-SMS-030). A broadcast or campaign already pointing at it fails with "No sendable SMS number connected" and does NOT fall back to another sender.
  5. `failed` and `pending` statuses exist on the shared table but SMS only ever writes connected and disconnected. A toggle of any non-connected row makes it connected.
  6. The workspace's engine cache is flushed.
- **Async & events:** none (port: emit `sms.sender.toggled`).
- **External systems:** none.
- **Settings:** plan `access_sms`.
- **Acceptance criteria:**
  - Given a connected sender, When toggled, Then it is disconnected, the flash says "deactivated" and it disappears from the pickers.
  - Given a sender id of another workspace, When toggled, Then "SMS number not found." and nothing changes.
  - Given a deactivated sender chosen by a scheduled campaign, When the campaign fires, Then it fails with "No sendable SMS number connected".
- **Source refs:** `app/Http/Controllers/Sms/SmsSettingsController.php`, `routes/sms.php`.
- **Port notes:** use an explicit boolean or status column on `sms_senders`; keep the not-found behaviour tenant-safe via RLS.

### TW-SMS-007 — Remove a sender

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002
- **Summary:** Delete a sender and its stored credentials.
- **Actors & access:** as TW-SMS-006.
- **UX & screens:** "Remove" button on the card with a browser confirm "Remove this SMS number?". The same action is offered from the Channels table on `/devices` (TW-SMS-028), which posts to the same route with a data-confirm.
- **Endpoints:**

| Method uri      | Route name       | Controller@action             | Middleware                 | Request fields | Response                          |
| --------------- | ---------------- | ----------------------------- | -------------------------- | -------------- | --------------------------------- |
| DELETE sms/{id} | user.sms.destroy | SmsSettingsController@destroy | web, auth, plan:access_sms | none           | redirect back with a status flash |

- **Data:** hard-deletes the matching `wa_provider_configs` row (id, current workspace, provider `sms`).
- **Rules & edge cases:**
  1. The flash is always "SMS number removed." even when no row matched (no not-found error here).
  2. Nothing is cascaded. Broadcasts and campaigns that referenced the sender keep a dangling `device_id`; at send time a missing sender falls back to the workspace's first connected SMS sender (primary first, then lowest id), and only fails when there is none (TW-SMS-030). QUIRK: a send can silently go out from a different number than the one chosen.
  3. Past delivery reports can no longer be tied to a sender row.
  4. The engine cache is flushed.
- **Async & events:** none (port: emit `sms.sender.removed`).
- **External systems:** none. Provider-side webhooks and numbers are left untouched.
- **Settings:** plan `access_sms`.
- **Acceptance criteria:**
  - Given a sender, When removed, Then it and its credentials are gone and the list updates.
  - Given a campaign pointing at the removed sender and another connected sender existing, When the campaign runs, Then it sends from the other sender (documented Reference behaviour).
  - Given an id that does not exist, When removed, Then the flash is still "SMS number removed." and nothing else changes.
- **Source refs:** `app/Http/Controllers/Sms/SmsSettingsController.php`, `resources/views/user/devices/_channel_rows.blade.php`.
- **Port notes:** decide soft delete versus hard delete (the message log in TW-SMS-029 should keep the sender label as text). Whether to keep the silent fallback is a decision for the reviewer; Reference keeps it.

### TW-SMS-008 — Number lookup: mobile, landline or invalid (Twilio Lookup)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-SMS-002
- **Summary:** The operator types a phone number and is told whether it can receive SMS, so money is not spent on landlines and typos (SMS is billed on submission, not delivery). Reference has no provider call that lists numbers or sender ids; this is its only lookup.
- **Actors & access:** workspace members with `access_sms`.
- **UX & screens:** card "Check a number before you text it" on `/sms`: a text input (placeholder "+1 555 123 4567"), the button "Check number" (label "Checking…" and disabled while running; Enter in the input also runs it) and a result line. The line is green when textable, coral when the number is valid-but-not-found or invalid, neutral otherwise. An empty input clears the line and does nothing. A failed request shows "Could not reach the lookup service."
- **Endpoints:**

| Method uri      | Route name      | Controller@action            | Middleware                 | Request fields | Response                                                                                        |
| --------------- | --------------- | ---------------------------- | -------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| POST sms/lookup | user.sms.lookup | SmsSettingsController@lookup | web, auth, plan:access_sms | phone          | JSON `{ok, valid, type, carrier, country, textable, reason, cached, describe}`; always HTTP 200 |

- **Data:** none stored. Cache entries keyed `sms.lookup.<digits>` with a `.c` suffix when carrier info is requested (it always is from this screen), kept 90 days.
- **Rules & edge cases:**
  1. The sender used is the workspace's first connected SMS sender (primary first, then lowest id). None: `{ok:false, reason:"Connect a Twilio SMS number first.", describe:<same>}`.
  2. The input is reduced to digits; no digits: reason "That is not a phone number." (nothing cached).
  3. A cache hit is returned first, with `cached = true`, before any provider check. QUIRK: the cache key has no workspace or provider in it, so one workspace's result serves every workspace and even an MSG91 sender; and with an MSG91 first sender and a cold cache the tool fails (rule 4).
  4. Non-Twilio sender and a cold cache: `{ok:false}` with "Number checking needs a Twilio account; this number is on msg91." QUIRK: a workspace with both providers whose first sender is MSG91 cannot use the tool even though it has Twilio.
  5. Provider call: GET `https://lookups.twilio.com/v2/PhoneNumbers/+<digits>` with `Fields=line_type_intelligence`, basic auth with the sender's SID and token, 12 s timeout.
  6. HTTP 404 means Twilio does not know the number: `ok = true`, `valid = false`, reason "Twilio does not recognise this number."; cached.
  7. Any other non-2xx: `ok = false`, reason = Twilio's `message` or "HTTP <status>"; not cached. A thrown error: "Could not reach the lookup service." (logged); not cached.
  8. Success: `valid` from Twilio's `valid`, `type` = `line_type_intelligence.type`, `carrier` = `line_type_intelligence.carrier_name`, `country` = `country_code`; cached.
  9. `textable` = ok AND valid AND type is not `landline` and not `voip`. An unknown or missing type counts as textable (so a list is not gutted by Lookup gaps).
  10. `describe` sentences: not ok: the reason (or "Could not check this number."); invalid: "Not a valid number — texting it would be charged and never arrive."; `mobile`: "Mobile — can receive SMS."; `landline`: "Landline — cannot receive SMS. Texting it is charged and lost."; `voip`: "VoIP — may not receive SMS reliably."; no type: "Valid number. Twilio did not report a line type."; other type X: "Valid X number." A carrier name is appended: " Carrier: <name>."
  11. Twilio bills each Lookup call; there is no workspace cap on it.
- **Async & events:** none.
- **External systems:** Twilio Lookup v2. Auth: the sender's Account SID and token.
- **Settings:** plan `access_sms`.
- **Acceptance criteria:**
  - Given a mobile number, When checked, Then the line reads "Mobile — can receive SMS." plus the carrier and is green.
  - Given a landline, When checked, Then `textable` is false and the line warns it is charged and lost.
  - Given the same number checked twice, When the second call runs, Then `cached` is true and Twilio is not called.
  - Given a workspace with no connected sender, When checked, Then "Connect a Twilio SMS number first."
  - Given empty or non-digit input, When checked, Then nothing is sent from the screen (empty) or "That is not a phone number." returns (non-digit).
- **Source refs:** `app/Services/Sms/SmsLookup.php`, `app/Http/Controllers/Sms/SmsSettingsController.php` (`lookup`), `resources/js/charts/user-sms.js`, `resources/views/user/sms/index.blade.php`.
- **Port notes:** scope the cache key by workspace (and provider) in the port, and pick the first connected TWILIO sender rather than the first sender; both are intentional improvements to record as differences. A lookup is a paid call: consider a per-workspace rate limit.

### TW-SMS-009 — Segment and encoding calculation (GSM-7 versus UCS-2)

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** A pure function that says how many SMS segments a text will cost, which encoding applies, how many units it uses and how many units remain in the last segment. Reference has the function and the operator warning text but nothing shows them to the user.
- **Actors & access:** internal.
- **UX & screens:** none in Reference (see rule 8). The port should show a live counter in the broadcast message preview, the campaign composer and the template editor.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Constants: GSM-7 single 160, GSM-7 per part when split 153 (7 units of concatenation header); UCS-2 single 70, per part when split 67.
  2. Encoding is GSM-7 only if EVERY character is in the GSM basic table or the GSM extension table. One character outside both makes the whole message UCS-2 ("GSM-7" / "UCS-2" are the reported labels).
  3. GSM basic table (exact set): `@ £ $ ¥ è é ù ì ò Ç`, line feed, `Ø ø`, carriage return, `Å å Δ _ Φ Γ Λ Ω Π Ψ Σ Θ Ξ Æ æ ß É`, space, `! " # ¤ % & ' ( ) * + , - . / 0 1 2 3 4 5 6 7 8 9 : ; < = > ? ¡`, `A-Z`, `Ä Ö Ñ Ü §`, `¿`, `a-z`, `ä ö ñ ü à`. (Backtick, tab, form feed, curly quotes, en/em dash and all emoji are NOT in it.)
  4. GSM extension table (cost 2 units each): `^ { } \ [ ~ ] | €`.
  5. Units: GSM-7 = sum of 1 per basic character and 2 per extension character; UCS-2 = number of Unicode code points (characters).
  6. Segments: units 0 (empty body) counts as 1 segment with the single-message size; units <= single size = 1 segment; else `ceil(units / multi size)`. Result: `{segments, encoding, units, per_segment, remaining}` where `per_segment` is the single size for one segment and the multi size otherwise, and `remaining = max(0, segments * per_segment - units)`.
  7. Worked values: 160 plain letters = 1 segment, 161 = 2, 306 = 2, 307 = 3; 70 UCS-2 characters = 1, 71 = 2, 134 = 2, 135 = 3; 81 euro signs = 162 units = 2 segments; an empty string = 1 segment, 160 remaining, encoding GSM-7.
  8. Operator warning (exists, never called by any screen): empty when segments <= 1. UCS-2: "This message contains characters outside the GSM alphabet (emoji or non-Latin script), so it is limited to 67 characters per SMS and will be billed as N messages." GSM-7: "This message is U characters and will be billed as N messages." (U is the unit count).
  9. QUIRK: an emoji or any character above U+FFFF counts as ONE unit here but occupies TWO UTF-16 code units on the wire, so UCS-2 messages with such characters are under-counted (a 70-emoji text is reported as 1 segment but is 2). Real carriers count code units.
  10. QUIRK: an extension character is never split across two segments on the wire, so a boundary can waste a unit; the function ignores that and can under-count by one segment in rare cases.
  11. Where it is used in Reference: only as a fallback segment count when the provider does not return one (TW-SMS-011, TW-SMS-012, runners) and for MSG91 sends it is the only count.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 160 GSM characters, When measured, Then 1 segment, "GSM-7", 160 units, 0 remaining.
  - Given 161 GSM characters, When measured, Then 2 segments, 153 per segment, 145 remaining.
  - Given "Hello 😀", When measured, Then encoding "UCS-2", 1 segment, per_segment 70.
  - Given 3 euro signs, When measured, Then 6 units and "GSM-7".
  - Given 71 UCS-2 characters, When measured, Then 2 segments of 67 and the warning names 67 characters per SMS and 2 messages.
- **Source refs:** `app/Services/Sms/SmsSegments.php`, `app/Services/Sms/Transports/TwilioTransport.php`, `app/Services/Sms/Transports/Msg91Transport.php`.
- **Port notes:** put it in `packages/contracts/src/channel-sms/segments.ts` as a pure function so the API and the web composer share one implementation (the shared package is the rule for shapes that cross the network). Property-test the table. Decide whether to count UTF-16 code units for UCS-2 (the correct wire behaviour) or keep Reference's code-point count; record it as a difference if changed.

### TW-SMS-010 — Provider seam: sendable check, phone normalisation, never-throw contract

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-002
- **Summary:** One entry point sends a message from a sender and hides which provider is behind it. Whatever happens, it returns a result object instead of throwing, so a bad send marks one recipient failed rather than killing a whole run.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads the sender (provider, From, credentials, sender id, DLT template id, rate, currency, active flag).
- **Rules & edge cases:**
  1. Provider choice: `msg91` (case-insensitive, trimmed) selects the MSG91 transport; anything else selects Twilio.
  2. Result shape: `{ok, message_id?, segments?, error?, code?, bad_credentials?}`. Implementations must not throw; network errors become `ok=false` with a readable text.
  3. A sender is sendable only when it is active (status connected), has a non-blank From, and has credentials: Twilio needs SID and token, MSG91 needs only the auth key (held in the token field).
  4. Not sendable: `{ok:false, error:"This SMS number has no credentials — reconnect it on the devices page."}`. (The text is also used for an inactive sender.)
  5. Recipient normalisation: Twilio: digits only with a leading `+` (no digits: "That recipient number could not be read as a phone number."). MSG91: digits only, no plus (same error). No library validation, no minimum or maximum length, no country check.
  6. An empty body after trimming: "Nothing to send — the message is empty." (both transports).
  7. Bodies are trimmed before sending, so leading and trailing whitespace and newlines are removed.
  8. An alphanumeric sender is detected by "From contains any letter". Such a sender is passed through verbatim on Twilio (no E.164 formatting); a numeric From is formatted to `+<digits>`. Alphanumeric ids are one-way; they are not usable in the US or Canada on Twilio (not enforced here).
  9. `bad_credentials` is set by both transports but nothing reads it: a revoked key does not deactivate the sender or alert anyone, every recipient just fails with the provider's text. Port: use it to flag the sender as needing attention.
  10. Phone assembly in the runners: contact country code digits + local digits, skipping the country code when the local number already starts with it; `+` and spaces removed.
- **Async & events:** none.
- **External systems:** Twilio and MSG91 (TW-SMS-011, TW-SMS-012).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sender with no auth token, When a send is attempted, Then it returns `ok=false` with the "no credentials" text and no HTTP call is made.
  - Given the recipient "(415) 555-1234" and a Twilio sender, When sent, Then the number is `+4155551234`.
  - Given an alphanumeric Twilio From "ACMEIN", When sent, Then From is `ACMEIN` unchanged.
  - Given a whitespace-only body, When sent, Then "Nothing to send — the message is empty." and no call is made.
- **Source refs:** `app/Services/Sms/SmsClient.php`, `app/Services/Sms/SmsSender.php`, `app/Services/Sms/Contracts/SmsTransport.php`, `app/Services/Sms/Transports/*.php`.
- **Port notes:** define a `SmsProvider` port in `apps/api/src/infra/providers/channel-sms/` with `send(sender, to, body)` returning a discriminated result, plus `TwilioSmsProvider` and `Msg91SmsProvider` adapters and a fake for tests; register in the global providers module as the provider-adapter skill requires.

### TW-SMS-011 — Send one SMS through Twilio

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-010
- **Summary:** A plain text SMS is posted to Twilio's Messages API from the sender's number or alphanumeric id, with a delivery-report callback pointing at us.
- **Actors & access:** internal (called by the runners).
- **UX & screens:** none.
- **Endpoints:** none of ours; outbound `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`.
- **Data:** reads the sender; the result's provider message id is the Twilio `sid`.
- **Rules & edge cases:**
  1. Form-encoded fields: `From`, `To` (`+digits`), `Body` (trimmed), `StatusCallback` = the app's public base URL (config `app.url`, forced to https) + `/api/sms/status`. Without a callback Twilio never reports delivered or failed.
  2. Basic auth with the SID and token, 20 s timeout. No retry inside the call.
  3. 2xx: `ok = true`, `message_id` = response `sid`, `segments` = response `num_segments` cast to int, falling back to the local calculation (TW-SMS-009) when the field is absent.
  4. Non-2xx: `ok = false`, `code` = Twilio's numeric error `code` (0 when absent), `bad_credentials` = HTTP 401 or 403, `error` = the translated message (TW-SMS-013) or Twilio's own text or "HTTP <status>".
  5. A network exception: "Could not reach the SMS provider: <exception text>".
  6. Messaging Service (`MessagingServiceSid`) is NOT supported: only `From`. The Reference docs and admin copy mention creating a Messaging Service; that path does not exist (docs-only).
  7. No media (no MMS), no scheduling at Twilio, no validity period, no `ShortenUrl`, no `ProvideFeedback`.
  8. The status callback URL is built from the platform URL setting, not the request, so it must be a public https URL.
- **Async & events:** the callback arrives later (TW-SMS-022).
- **External systems:** Twilio Programmable SMS. Rate limits: not handled (see TW-SMS-017 on throttling).
- **Settings:** the app's public URL.
- **Acceptance criteria:**
  - Given a connected Twilio sender, When a message is sent, Then Twilio receives From, To, Body and the https status callback and our result carries the Twilio sid and segment count.
  - Given Twilio returns error 21211, When sent, Then the error text tells the operator to use full international format, e.g. +919876543210.
  - Given Twilio is unreachable, When sent, Then the result is `ok=false` with "Could not reach the SMS provider: ...".
- **Source refs:** `app/Services/Sms/Transports/TwilioTransport.php`, `app/Services/Sms/SmsSegments.php`.
- **Port notes:** build the callback URL from a configured public base URL (`apps/api/src/config/domains/channel-sms.env.ts`). Consider a signed or tokenised callback path (see TW-SMS-022). Store the Twilio `sid` as `provider_message_id` (indexed).

### TW-SMS-012 — Send one SMS through MSG91 (DLT flow route or plain route)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-010, TW-SMS-005
- **Summary:** MSG91 is the Indian route. With a DLT template id on the sender, the message goes through MSG91's template ("flow") API; without one it goes through the free-text API.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** outbound only. Flow: `POST https://control.msg91.com/api/v5/flow/`. Plain: `POST https://control.msg91.com/api/v2/sendsms`. Both with headers `authkey`, JSON content and accept, 20 s timeout.
- **Data:** reads the sender (auth key in the token field, `sender_id`, `dlt_template_id`).
- **Rules & edge cases:**
  1. Recipient: digits with the country code and no plus. Body trimmed.
  2. Flow route payload: `template_id` = the DLT template id, `short_url = "0"`, one recipient object with `mobiles`, `VAR1` = the full message text and `body` = the full message text, plus `sender` only when the sender id is non-blank. Both `VAR1` and `body` are sent because MSG91 substitutes by the variable name the template registered and ignores unknown keys. So the registered template must be effectively a single variable placeholder carrying the whole text.
  3. Plain route payload: `sender` = the sender id or `MSGIND` when blank, `route = "4"` (transactional; promotional route 1 is refused for Indian numbers without DLT), `country = "0"`, `sms` = a list of one entry with `message` and `to` (a list of the one number).
  4. The From number of the sender is NOT used by either route.
  5. Outcome: MSG91 can answer HTTP 200 with `{"type":"error"}` for a real failure, so success = HTTP 2xx AND `type` is not "error" (case-insensitive). Success: `message_id` = the response `request_id`, else `message`; `segments` = local calculation (TW-SMS-009), because MSG91 does not return a count.
  6. Failure: `code` = response `code` or the HTTP status as text; `bad_credentials` when HTTP 401 or the message contains "authkey" or "authentication"; `error` = translated (TW-SMS-013).
  7. A network exception: "Could not reach MSG91: <exception text>".
  8. One recipient per request (no MSG91 bulk batching). Reference notes that it was never verified against a live MSG91 account.
  9. Unicode (non-GSM) text is sent without MSG91's unicode flag on the plain route; Indian-language delivery is therefore unverified.
  10. The delivery-report webhook must be configured in the MSG91 panel by the operator (TW-SMS-022); there is no per-message callback.
- **Async & events:** the DLR arrives later at our status URL.
- **External systems:** MSG91 v5 flow API and v2 sendsms API. Auth: `authkey` header. Credits: an out-of-credit account fails with the translated balance message.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sender with a DLT template id and sender id, When a message is sent, Then the flow route is called with that template, the text in `VAR1` and `body`, and the sender.
  - Given a sender with no DLT template id and no sender id, When a message is sent, Then the plain route is called with sender `MSGIND`, route `4`.
  - Given MSG91 returns HTTP 200 with type "error", When sent, Then the result is `ok=false` with the translated message.
  - Given success, When the result is read, Then `message_id` is the MSG91 request id and `segments` is the local count.
- **Source refs:** `app/Services/Sms/Transports/Msg91Transport.php`.
- **Port notes:** keep both routes. Capture the raw MSG91 response in a debug log (redacted) because the shapes are unverified. Consider MSG91's batching later, not now.

### TW-SMS-013 — Provider error translation into operator messages

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-SMS-011, TW-SMS-012
- **Summary:** Provider failure codes and texts are turned into sentences an operator can act on. The text is stored per recipient.
- **Actors & access:** internal; the text is shown in the recipient failure column.
- **UX & screens:** appears as the recipient error on broadcast and campaign detail screens.
- **Endpoints:** none.
- **Data:** the translated text goes to the recipient's `error_message`.
- **Rules & edge cases:**
  1. Twilio code to text (all other codes keep Twilio's own message, or "HTTP <status>"):

| Code         | Meaning in our text                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 572006       | Trial accounts can only send their own preset templates, so this message was refused; add billing to the Twilio account to send your own text. |
| 21608        | Trial accounts can only send to verified numbers; verify the recipient in the Twilio console or add billing.                                   |
| 21211        | Twilio could not read the recipient number; it must be full international format, e.g. +919876543210.                                          |
| 21606, 21212 | The sending number is not valid for SMS on this Twilio account; check it is SMS-capable in the console.                                        |
| 21610        | This recipient has replied STOP and is unsubscribed; carriers require they text START before you can message them again.                       |
| 21614        | That recipient number cannot receive SMS.                                                                                                      |

2. MSG91, matched on the lower-cased response message, first match wins: contains "authkey" or "authentication": "MSG91 rejected the auth key — check it on the devices page."; contains "dlt" or "template": "MSG91 rejected the DLT template id. The template must be approved on the DLT portal and linked to this sender id. (<original message>)"; contains "sender": "MSG91 rejected the sender id. It must be exactly 6 letters and DLT-registered. (<original message>)"; contains "balance" or "credit": "The MSG91 account is out of credit."; otherwise the original message (or "HTTP <status>").
3. The stored recipient error is the translated text. At the campaign level a recipient error is shown truncated by the existing campaign screens (the column limit applies in that domain).
4. QUIRK: code 21610 is shown but the contact is NOT marked unsubscribed, so the next broadcast tries and fails again for the same contact. See Open questions.
5. "Send failed" with no provider text falls back to the literal "SMS send failed".

- **Async & events:** none.
- **External systems:** Twilio and MSG91 error bodies.
- **Settings:** none.
- **Acceptance criteria:**
  - Given Twilio error 21610, When a send fails, Then the recipient error explains STOP and START.
  - Given MSG91 message "Invalid sender ID", When a send fails, Then the translated text names the 6-letter DLT rule and keeps the original in brackets.
  - Given an unknown Twilio code, When a send fails, Then Twilio's own message is stored.
- **Source refs:** `app/Services/Sms/Transports/TwilioTransport.php` (`explain`), `app/Services/Sms/Transports/Msg91Transport.php` (`explain`).
- **Port notes:** keep codes in the message log (`error_code`) as well as the text so reports can group failures; Reference stores text only.

### TW-SMS-014 — Merge variables ({{token}}) in SMS bodies

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** contacts-attributes-tags
- **Summary:** `{{name}}`-style tokens in an SMS body are replaced per recipient with the contact's data. This is the same resolver the WhatsApp campaign path uses.
- **Actors & access:** internal, at send time.
- **UX & screens:** the composer insert picker belongs to the broadcasts and campaigns domains; SMS has no preview of the resolved text.
- **Endpoints:** none.
- **Data:** reads the recipient's contact (country code, mobile, name, first name, last name, email, custom attributes), the workspace's static attributes, and system tokens.
- **Rules & edge cases:**
  1. A token is `{{`, optional spaces, a name (no braces), optional spaces, `}}`. The body is scanned only if it contains `{{`.
  2. Lookup order for a token: (a) the contact fields `phone`, `name`, `first_name`, `last_name`, `email` (matched by exact key); (b) the contact's custom attributes, matched case-insensitively on the normalised key; (c) the workspace's static attributes; (d) system tokens. The first non-empty value wins. Both the key as written and its normalised form are tried.
  3. Key normalisation: lower-case, trim, whitespace and dashes and dots become `_`, characters other than a-z, 0-9, `_` are removed, leading or trailing `_` trimmed, then an alias map is applied: `phone_number`, `phone_no`, `whatsapp_number`, `number`, `contact_number` to `phone`; `mobile_number`, `mobile_no` to `mobile`; `full_name`, `customer_name`, `contact_name` to `name`; `first` to `first_name`; `last`, `surname` to `last_name`; `mail`, `email_address`, `e_mail` to `email`; `sender_name`, `sender`, `business`, `brand`, `brand_name`, `whatsapp_name`, `store_name`, `shop_name` to `business_name`; `company_name` and `city` map to themselves.
  4. System tokens: `today` = the current date (YYYY-MM-DD, server time zone); `business_name` = the sender workspace's business name (the connected WhatsApp number's verified name; blank for an SMS-only workspace); `company_name` = the business name, else the platform brand name.
  5. Array-valued attributes are flattened to a comma-separated list. An unknown token resolves to an empty string, and the braces vanish (no literal `{{x}}` is sent).
  6. The runners add the recipient's `phone` (digits, no plus), `name`, `first_name`, `last_name`, `email` and custom attributes to the lookup; `mobile` and `city` are only available through custom attributes.
  7. After substitution a body that is blank (after trimming) fails that recipient with "Empty phone or message".
  8. QUIRK (defect): numbered tokens do not resolve. The campaign store rewrites named tokens in the message to `{{1}}`, `{{2}}` and keeps a slot-to-key map; the template save does the same to a template body and keeps the map in `variable_map`. The SMS runners read neither map, so a named variable saved from the composer or template editor reaches the recipient as an EMPTY string (a hand-typed `{{1}}` resolves to nothing as well). The port must resolve the slot map (or keep named tokens), and must not repeat this.
  9. Template send-time `template_overrides` and header, footer and buttons are ignored by the SMS broadcast runner.
  10. No merge-variable length control: a long name can push a message into extra segments.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace attributes (other domain).
- **Acceptance criteria:**
  - Given the body "Hi {{first_name}}, your code is {{ city }}" and a contact with those values, When personalised, Then both are substituted (case and spacing tolerant).
  - Given a contact with no value for a token, When personalised, Then the token is replaced with an empty string and the rest is sent.
  - Given a body saved as "Hi {{1}}" with the map {1: first_name}, When the port sends it, Then the recipient sees the first name (Reference sends an empty string; this is the intended behaviour).
  - Given a body that becomes empty after substitution, When sent, Then the recipient is marked failed with "Empty phone or message".
- **Source refs:** `app/Services/TemplateOverrideResolver.php` (`TOKEN_RE`, `ALIASES`, `lookup`, `normalizeKey`, `workspaceAttributes`), `app/Services/Sms/SmsBroadcastRunner.php`, `app/Services/Sms/SmsCampaignRunner.php`, `app/Http/Controllers/WaCampaignsController.php` (`normalizeCustomMessage`), `app/Http/Controllers/TemplatesController.php` (`normalizePlaceholders`).
- **Port notes:** one shared resolver in the contacts or templates domain; SMS must call the slot-map aware path. Segment cost depends on the resolved text, so measure after substitution.

### TW-SMS-015 — SMS templates: local plain-text messages

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** message-templates
- **Summary:** An SMS template is a saved plain-text message with no approval step. It appears as a channel option in the template builder when SMS is switched on and the workspace has a connected sender.
- **Actors & access:** workspace members who can create templates. The SMS option shows only when `sms_enabled` is on AND the workspace has at least one connected SMS sender (otherwise it is absent from the channel step and a posted `sms` channel falls back to the default channel).
- **UX & screens:** `resources/views/user/templates/create.blade.php`: channel radio card "SMS" with the line "A plain-text SMS — ready instantly, no Meta approval." (SMS is excluded from the picker unless the page is a local-channel one). The form is the shared template form; only the name and body matter for SMS.
- **Endpoints:** the shared template create and update routes (message-templates domain).
- **Data:** `wa_templates` row with `channel = 'sms'`, `status = 'approved'`, `meta_status = 'APPROVED'`, `approved_at` = now, never submitted to Meta. Fields: `template_name` (required, max 191), `template_body` (required, max 4096), `header` and `footer` (max 255, stored, unused by SMS sends).
- **Rules & edge cases:**
  1. No DLT fields on a template (TW-SMS-005 rule 2).
  2. The body is plain text: no media, buttons or carousel are used by the SMS send. Header, footer and buttons saved on the same row are not sent.
  3. Named placeholders in the body are rewritten to `{{1}}`, `{{2}}` on save (see TW-SMS-014 rule 8).
  4. The body has no length warning; the user is not told about segments (TW-SMS-009).
  5. QUIRK: the broadcast template picker lists every approved workspace template regardless of channel, so a WhatsApp template (with header, footer, buttons) can be chosen for an SMS broadcast and only its body is sent. The port should filter the picker to `sms` templates.
  6. The shared 4096 limit is far beyond one SMS (up to 27 GSM-7 segments); no hard cap exists.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `sms_enabled`.
- **Acceptance criteria:**
  - Given SMS on and a connected sender, When creating a template, Then the SMS channel is offered and the saved template is immediately approved.
  - Given no connected sender, When creating a template, Then the SMS channel is not offered.
  - Given a body over 4096 characters, When saved, Then the shared "max 4096" validation rejects it.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (channel availability and `store`, `validateTemplate`), `resources/views/user/templates/create.blade.php`.
- **Port notes:** message-templates owns the table; this domain contributes the `sms` channel value, its availability rule, and a segment counter in the editor. Record any needed extension in that domain's inventory rather than editing it here.

### TW-SMS-016 — SMS broadcast: chooser card, composer, audience, sender fan-out

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-015, TW-SMS-030
- **Summary:** The broadcasts screen offers an SMS card; opening it scopes the shared composer to SMS senders, then one broadcast row is created per picked sender with the audience split between them by weight.
- **Actors & access:** workspace admins (the broadcast and campaign routes require the admin workspace role) on a plan with the `broadcast` feature and room under `broadcast_limit` (both apply to SMS), plus SMS enabled with a connected sender for the card to appear. The SMS plan gate `access_sms` is NOT checked on the broadcast routes (QUIRK).
- **UX & screens:** `resources/views/user/broadcasts/index.blade.php` shows a card "SMS" with "Create SMS broadcast" when `sms_enabled` is on and the workspace has a connected SMS sender; it links to `/broadcasts/create?channel=sms`. The composer (`resources/views/user/broadcasts/create.blade.php`) is the shared WhatsApp composer: broadcast name, "Select template message" (approved templates, a live preview), audience (contacts, groups, tags), "Send from" (SMS senders only on this card, WhatsApp-only senders are removed), per-sender share weights when several are ticked, send now or later with date, time and time zone.
- **Endpoints:**

| Method uri            | Route name             | Controller@action           | Middleware                      | Request fields                                                                                                                                                          | Response                                   |
| --------------------- | ---------------------- | --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| GET broadcasts/create | user.broadcasts.create | BroadcastsController@create | web, auth, workspace.role:admin | channel=sms (query)                                                                                                                                                     | composer view                              |
| POST broadcasts       | user.broadcasts.store  | BroadcastsController@store  | web, auth, workspace.role:admin | broadcast_name, template_id, template_overrides, contacts[], groups[], tags[], device_ids[] (`sms:<id>`), device_share[], schedule_type, send_date, send_time, timezone | redirect to the list with a flash, or JSON |

- **Data:** one `broadcasts` row per picked sender: `provider = 'sms'`, `device_id` = the sender row id, `template_id`, `template_overrides` (sanitised JSON, unused by SMS), `name` (suffixed " · <sender label>" when several senders), `timezone` (default "UTC"), `status` (`processing` for now, `scheduled` for later), `scheduled_at`, `total_recipients`; plus `broadcast_contacts` rows (status `pending`).
- **Rules & edge cases:**
  1. Validation: `broadcast_name` required max 255; `template_id` nullable, must exist; `contacts.*` integer existing; `groups.*` integer existing; `tags.*` integer; `device_ids.*` string max 64; `device_share.*` nullable numeric 0..1000; `schedule_type` required `now` or `later`; `send_date` required when later, format `Y-m-d`; `send_time` required when later; `timezone` max 64.
  2. Gates, in order: the `broadcast` plan feature, then `broadcast_limit` against the workspace's broadcast count (workspace-wide, includes WhatsApp ones).
  3. Sender keys `sms:<id>` are resolved against the workspace's senders; a stale or foreign key is dropped silently. With no valid sender a single device-less broadcast is created and the runner later falls back to the first connected SMS sender (TW-SMS-030).
  4. Audience = the union of picked contacts, members of picked groups (a contact belongs to groups through its group list) and contacts carrying picked tags, de-duplicated, all restricted to the current workspace (foreign ids are ignored).
  5. Opted-out contacts (`is_unsubscribed = true`) are removed before the broadcast exists. If nobody is left: "Select at least one contact or group (opted-out contacts are skipped automatically)."
  6. A wallet precheck for the recipient count runs through the shared send gate. For workspaces on pay-per-message billing an empty wallet blocks even an SMS broadcast with the gate's message, although SMS is never charged to the wallet (QUIRK).
  7. A picked template is looked up in the workspace: "Selected template was not found in your workspace." Authentication (OTP) templates are refused: "Authentication (OTP) templates cannot be broadcast — each recipient needs a unique verifiable code. Send them 1:1 from your backend using the transactional template send endpoint instead."
  8. The WhatsApp media reachability check and Meta quality gates also run for a chosen template with a media header (irrelevant to SMS). They are not ported for SMS-only templates.
  9. With N senders ticked, the audience is split into N sequential slices by weight (weights default to 1; non-positive means 1): slice sizes are the floor of each exact share, with the remainder given to the largest fractional parts, so the split is within 1 of ideal. Empty slices are skipped when there is more than one sender.
  10. QUIRK: the web composer has no free-text field. An SMS broadcast without a template has an empty body, so every recipient fails with "Empty phone or message". The runner can send a free caption (`temp_caption`, set only by the mobile queue API), but the web form never sets it. Port decision: add a direct message field (see TW-SMS-018, which has one) or require a template.
  11. The warm-up governor applies to an SMS sender only if a warm-up profile is enabled on that row; the SMS screens expose no warm-up setting, so in practice it is off.
  12. Success flash: `Broadcast "<name>" sent.` or `scheduled.` (or "N broadcasts sent across M devices." when fanned out). The flash is the same even if every recipient later fails.
- **Async & events:** the runner is called synchronously from the request, one broadcast after another (TW-SMS-017). Port: queue it.
- **External systems:** none directly.
- **Settings:** `sms_enabled`, plans `broadcast`, `broadcast_limit`.
- **Acceptance criteria:**
  - Given SMS enabled and a connected sender, When the broadcasts screen loads, Then the SMS card shows; Given no connected sender, Then it does not.
  - Given two SMS senders ticked with weights 3 and 1 and 100 contacts, When submitted, Then two broadcasts are created with 75 and 25 recipients and names suffixed with the sender label.
  - Given an audience that is entirely opted out, When submitted, Then the "Select at least one contact or group" error shows and nothing is created.
  - Given an OTP-type template, When submitted, Then it is refused with the authentication message.
  - Given `schedule_type = later` with no date, When submitted, Then the date is required.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (`create`, `store`), `resources/views/user/broadcasts/index.blade.php`, `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js`.
- **Port notes:** the broadcasts module owns the composer, the recipient table and the split algorithm; add an `sms` channel option with its own sender list and a message input with a live segment counter. Enforce `access_sms` on these routes in the port (the channel is paid) and record it as a difference.

### TW-SMS-017 — SMS broadcast runner: sequential send, counters, status

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-SMS-016, TW-SMS-010
- **Summary:** For a broadcast whose provider is SMS, a PHP runner (not the Node bridge) loops over its recipients, sends each, records the result on the recipient row and finalises the broadcast.
- **Actors & access:** internal. Called from the broadcast store, the manual retry and the broadcast sweeper.
- **UX & screens:** the broadcast list and detail show status, success and fail counts and per-recipient status and error.
- **Endpoints:** none of its own.
- **Data:** reads `broadcasts`, `broadcast_contacts`, contacts, the template body or caption; writes per recipient `status` (`sent` or `failed`), `whatsapp_message_id` (the provider message id; the column name is a WhatsApp leftover), `error_message`, `sent_at`; writes on the broadcast `status`, `success_count`, `fail_count`, `completed_at`.
- **Rules & edge cases:**
  1. Sender: the broadcast's `device_id` sender; if that row no longer exists, the workspace's first connected SMS sender. If there is no sender or it is not sendable: broadcast `failed`, result "No sendable SMS number connected".
  2. Quota check once before the loop (TW-SMS-026). Over the cap: broadcast `failed` with the plan-limit text as the result.
  3. Body: the template's plain body, else the broadcast's free caption. Missing template: empty body.
  4. Recipients: the broadcast's contacts (limited to the retry list when given), each with phone = country code + local number (TW-SMS-010 rule 10); contacts with no phone are dropped. None left: broadcast `failed`, "No recipients with a usable phone number".
  5. Per recipient, in order of the contact list: personalise (TW-SMS-014); if the personalised body is blank: failed "Empty phone or message"; else send. The segment count (provider's, else local) is added to the run total whether the send succeeded or not.
  6. No sleep, batch size, concurrency, daily cap, active-hours window or per-second limit (TW-SMS-021 rule 5). One message at a time; a 20 s provider timeout per call; a 10,000-recipient broadcast runs inside the request or the retry call.
  7. Final status: no failures `completed`; some `completed_with_errors`; all `failed`. `success_count` and `fail_count` are set to THIS RUN's totals; `completed_at` = now. QUIRK: a retry run (TW-SMS-021) overwrites the counters with only the retried subset, so `success_count` can drop.
  8. Cost = round(total segments x the sender's rate per segment, 4); it is logged and returned only, never stored or shown (TW-SMS-027).
  9. Pivot updates never clear an earlier error on a later success (a blank value is not written).
  10. QUIRK: the callers ignore the runner's return value, so failures such as a missing sender or an exhausted quota reach the user only as a failed broadcast status; the "sent" flash has already been shown.
  11. Not scheduled-aware: see TW-SMS-020.
  12. Each success is mirrored into the inbox thread in Reference (TW-SMS-D07); the port writes the outbound record instead (TW-SMS-029).
- **Async & events:** synchronous in Reference. Port: a BullMQ job on the worker (one job per broadcast, iterating in small chunks with a heartbeat) with an idempotency key per recipient so a restart cannot double-send.
- **External systems:** Twilio or MSG91 per sender.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast of 3 contacts where one has no phone, When run, Then 2 are sent and the contact with no phone is not part of the run.
  - Given 1 success and 1 failure, When run, Then the status is `completed_with_errors`, `success_count` = 1, `fail_count` = 1, and the failed recipient carries the provider text.
  - Given all sends fail, When run, Then the status is `failed`.
  - Given the sender was deactivated, When run, Then the broadcast is `failed` with "No sendable SMS number connected" and no HTTP call is made.
  - Given the monthly cap is reached, When run, Then the broadcast is `failed` and nothing is sent.
- **Source refs:** `app/Services/Sms/SmsBroadcastRunner.php`, `app/Http/Controllers/BroadcastsController.php` (`dispatchToBridge`).
- **Port notes:** home `apps/api/src/modules/channel-sms/broadcast-run/` plus a worker processor (worker-job skill); never run it in the API process. Recompute the counters from the recipient rows (like campaigns do) so retries are correct. Persist segments and cost per message (TW-SMS-029).

### TW-SMS-018 — SMS campaign builder: chooser card, fields kept and fields ignored

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-030
- **Summary:** The campaign screen offers an SMS card; the builder is the WhatsApp one with the template and flow choices hidden, leaving a free-text message to a chosen audience and schedule.
- **Actors & access:** workspace admins (admin workspace role required) with the `campaign` feature and room under `total_campaigns_limit`. `access_sms` is not checked on the campaign routes.
- **UX & screens:** `resources/views/user/wa-campaigns/index.blade.php` shows an SMS card ("Create SMS campaign") when `sms_enabled` and a connected sender exist; it links to `wa-campaigns/create?channel=sms`. `resources/views/user/wa-campaigns/create.blade.php` with `channel = sms`: the template and flow tiles are hidden (only "Custom message" remains), the sender picker lists SMS senders only. The A/B toggle, media upload, header, footer, buttons and the Smart Delivery fields remain visible even though SMS ignores them (see rule 8).
- **Endpoints:**

| Method uri              | Route name               | Controller@action            | Middleware                      | Request fields                                                                                                                                                                                                        | Response                                                                     |
| ----------------------- | ------------------------ | ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET wa-campaigns/create | user.wa-campaigns.create | WaCampaignsController@create | web, auth, workspace.role:admin | channel=sms (query)                                                                                                                                                                                                   | builder view                                                                 |
| POST wa-campaigns       | user.wa-campaigns.store  | WaCampaignsController@store  | web, auth, workspace.role:admin | campaign_name, sender (`sms:<id>`), campaign_type, custom_message, schedule_type, send_date, send_time, timezone, repeat_interval, repeat_until, expires_at, recipients[], groups[], tags[], manual_numbers, csv_file | redirect to the campaign detail, or JSON `{ok, message, campaign, redirect}` |

- **Data:** `wp_campaigns` row with `provider = 'sms'`, `device_id` = the sender row id, `campaign_type`, `custom_message`, schedule fields, `total_recipients`, `status`; `wp_campaign_contacts` rows pre-created per recipient with `status = 'queued'` (and a variant A/B when A/B is on).
- **Rules & edge cases:**
  1. Gates: the `campaign` feature; the `total_campaigns_limit` quota against a delete-proof usage counter (deleting a campaign does not free a slot; message "You've reached your plan's limit of N total campaigns. Upgrade your plan to create more.").
  2. Validation: `campaign_name` required max 191; `campaign_type` required one of `text`, `template`, `button`, `flow`, `media`, `custom`; `custom_message` required when the type is text, custom, button or media; `schedule_type` required `now`, `scheduled` or `recurring`; `timezone` must be a valid time zone name; `repeat_interval` one of daily, weekly, monthly; `csv_file` csv or txt up to 5 MB; `ab_split` 0..100; `throttle_max_sec >= throttle_min_sec`.
  3. The `sender` key `sms:<id>` is resolved against the workspace's connected senders; the campaign stores `provider = 'sms'` and the row id. A bare `device_id` with no sender key is treated as a WhatsApp (unofficial) device, so an SMS campaign always needs the composite key.
  4. Audience: picked contacts, groups, tags, plus manual numbers (split on whitespace, commas, semicolons; digits only; at least 8 digits) and a CSV of numbers. Each manual or CSV number creates or reuses a contact (name from a CSV "name" column, else "Recipient · <last 4 digits>"; other CSV columns become custom attributes so they can be used as variables). All lookups are restricted to the workspace.
  5. Opted-out contacts are dropped by the runner, not at creation, so `total_recipients` includes them (TW-SMS-024).
  6. The message is normalised: named tokens become `{{1}}`, `{{2}}` with a slot map (TW-SMS-014 rule 8).
  7. A free-text body guardrail check runs on `custom_message` (the platform's content filter; in monitor mode it only logs; in enforce mode the flash carries its message).
  8. Ignored by the SMS runner (stored, shown, not used): A/B variants (everyone gets `custom_message`), header, footer, buttons, quick replies, uploaded image, video or document, Smart Delivery throttle, batch, daily limit and window, `expires_at`, tracking, `template_id`. QUIRK: the screen offers these; none of them does anything for SMS.
  9. Send now (`schedule_type = now`): status `running` and the runner starts after the HTTP response (TW-SMS-019). Scheduled and recurring wait for the sweeper (TW-SMS-020). Flash: "Campaign launched.", "Campaign scheduled." or "Recurring campaign saved."
  10. Editing a campaign keeps the SMS sender list scoped to SMS senders (a campaign with `provider = 'sms'` never offers WhatsApp senders).
- **Async & events:** the send runs after the response (`afterResponse`), inline when the server cannot defer.
- **External systems:** none directly.
- **Settings:** `sms_enabled`, plans `campaign`, `total_campaigns_limit`.
- **Acceptance criteria:**
  - Given SMS on and a connected sender, When the campaigns screen loads, Then the SMS card shows; the SMS builder shows no template or flow tile.
  - Given a custom SMS campaign with 3 contacts and 2 pasted numbers (one with 6 digits), When saved, Then 4 recipients are created (the 6-digit number is dropped) and the status is `running` for now.
  - Given `schedule_type = scheduled` with no date, When saved, Then it stays `scheduled` waiting for the sweeper.
  - Given the total campaigns quota is used up, When saved, Then the quota message shows and nothing is created.
  - Given an A/B-enabled SMS campaign, When run, Then every recipient gets variant A text (Reference); the port should either send B text to B recipients or hide the A/B control.
- **Source refs:** `app/Http/Controllers/WaCampaignsController.php` (`create`, `store`, `edit`, `normalizeCustomMessage`), `resources/views/user/wa-campaigns/index.blade.php`, `resources/views/user/wa-campaigns/create.blade.php`.
- **Port notes:** the campaigns module owns the wizard and the recipient table; this domain adds the `sms` channel, its sender list, a plain textarea with the segment counter and the hidden-fields rule. Hide, do not offer, the controls SMS ignores. Enforce `access_sms` at the module boundary.

### TW-SMS-019 — SMS campaign runner: sequential send, per-recipient rows, KPI recompute

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-SMS-018, TW-SMS-010
- **Summary:** For a campaign whose provider is SMS, the shared campaign sender hands off to a PHP runner that sends the free-text message to each recipient and records per-recipient results that feed the campaign analytics.
- **Actors & access:** internal. Called for send-now, the sweeper (scheduled, recurring, resumed) and manual resends, all through one funnel.
- **UX & screens:** campaign list and detail analytics (sent, delivered, failed, per-recipient log).
- **Endpoints:** none of its own.
- **Data:** reads `wp_campaigns`, contacts; writes `wp_campaign_contacts` (`status` queued then `sent` or `failed`, `whatsapp_message_id` = provider message id, `sent_at`, `error_message`), updates `wp_campaigns.status`, `completed_at` and the aggregate counters.
- **Rules & edge cases:**
  1. Sender, quota and no-recipients handling are the same as TW-SMS-017 rules 1, 2, 4 (campaign status `failed`).
  2. Body: the campaign's `custom_message` (or the template body when a template id is set). Header, footer, buttons and media are not part of the body.
  3. Recipients: the contact ids handed in, restricted to the campaign's workspace, excluding opted-out contacts (`is_unsubscribed` true; null counts as not opted out), reduced to those with a phone.
  4. Per recipient: same flow as the broadcast runner (personalise, blank check, send, count segments). A recipient row is updated, or created if it does not exist. A repeated update does not clear a stored error on success only when the error field is empty (a non-empty error is written only on failure).
  5. Final status: no failures `completed`; some `completed_with_errors`; all `failed`; `completed_at` = now; then the campaign recomputes its aggregate counters from the recipient rows (sent includes delivered, read and responded or any row with a sent time; delivered includes read and responded).
  6. The runner records no cost and no failure-attempt counters (`send_attempts`, `next_attempt_at` stay untouched), so the campaign-level retry-with-backoff of the WhatsApp path does not apply (TW-SMS-021).
  7. Re-entry safety: a run only receives the recipients that still need sending when the campaign is re-fired (non-recurring campaigns skip rows already `sent`, `delivered`, `read`, `responded`, `unsubscribed` or `skipped`), so a resume after a crash does not re-send to done recipients. A recurring campaign re-sends to everyone each cadence by design.
  8. Everything sends in one synchronous loop with no pacing (see TW-SMS-021 rule 5).
  9. Each success is mirrored into the inbox in Reference (TW-SMS-D07); the port writes the outbound record (TW-SMS-029).
- **Async & events:** runs after the response; the scheduler sweeper drives scheduled and recurring ones (TW-SMS-020). Port: a worker job per campaign and a per-recipient send with an idempotency key.
- **External systems:** Twilio or MSG91.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a campaign with 5 recipients, one opted out, When run, Then 4 messages are sent, the opted-out one is skipped and the status becomes `completed`.
  - Given one provider failure among successes, When run, Then the status is `completed_with_errors` and the campaign `sent_count` reflects the successes.
  - Given a crash mid-run and a later re-fire of a one-shot campaign, When it runs again, Then already-sent recipients are not sent twice.
  - Given a recurring campaign, When its next cadence fires, Then every non-opted-out recipient is sent to again.
- **Source refs:** `app/Services/Sms/SmsCampaignRunner.php`, `app/Http/Controllers/WaCampaignsController.php` (`runCampaignNowPaced`, `dispatchCampaignNow`, `fireScheduledCampaign`), `app/Models/WpCampaign.php` (`recomputeAggregates`).
- **Port notes:** the campaigns module owns the status machine; plug SMS in as a channel adapter instead of an "intercept at the top of the loop". Make the send idempotent per (campaign, contact, cadence) so a restart cannot double-send and double-charge the provider.

### TW-SMS-020 — Scheduling and recurrence for SMS sends

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-017, TW-SMS-019
- **Summary:** Campaigns can be sent now, scheduled for a date and time in a time zone, or repeated daily, weekly or monthly. Broadcasts have a send-later option.
- **Actors & access:** as TW-SMS-016 and TW-SMS-018.
- **UX & screens:** schedule step of each composer: now or later; date, time and time zone (the workspace's zone preselected); campaigns add recurring with interval and "repeat until" and an optional auto-end date.
- **Endpoints:** none of their own.
- **Data:** campaign: `schedule_type` (`now`, `scheduled`, `recurring`), `send_date`, `send_time`, `timezone` (stored; blank falls back to the workspace zone, then the app default), `repeat_interval` (`daily`, `weekly` default, `monthly`), `repeat_until`, `expires_at`, `last_run_at`. Broadcast: `scheduled_at`, `timezone`.
- **Rules & edge cases:**
  1. Campaigns: a scheduled or recurring campaign stays `scheduled` until its date and time (in its own zone) pass. The shared sweeper, driven by the node bridge heartbeat every 30 s in Reference, fires up to 25 due campaigns per tick under a lock and sends them through the same path as "send now". Recurring ones re-arm to the next cadence and reset every recipient to `queued`.
  2. Port decision on the clock source: Reference uses the node bridge heartbeat; the port uses a BullMQ repeatable job (worker-job skill).
  3. QUIRK (defect): an SMS BROADCAST ignores "send later". The store calls the same hand-off as send-now, and the SMS branch runs the runner at once whatever the schedule, so the broadcast is sent immediately and its `scheduled_at` is never used (no other mechanism fires it; the sweeper excludes the `scheduled` status and the runner finishes it as completed). The port must honour the schedule (a delayed job), because the composer promises it.
  4. QUIRK: the SMS campaign runner does not apply the Smart Delivery active-hours window, daily limit or expiry date (TW-SMS-018 rule 8), so a scheduled SMS campaign can send at any hour inside the cadence and past `expires_at`.
  5. There is no quiet-hours rule for SMS in Reference. India's regulator restricts promotional SMS to a daytime window; it is not modelled (see Open questions).
  6. A stalled run is rescued (TW-SMS-021).
- **Async & events:** the campaign sweeper and the broadcast heartbeat; audit entries live in the shared domains.
- **External systems:** none.
- **Settings:** admin defaults for retry attempts and campaign auto-end (shared domains).
- **Acceptance criteria:**
  - Given a campaign scheduled for 10:00 in Asia/Kolkata, When the clock passes 10:00 there, Then it fires once and shows `running` then a final status.
  - Given a recurring weekly campaign, When it completes a cadence, Then its next send date moves forward one week and its recipients are reset to queued.
  - Given a broadcast scheduled for tomorrow, When the port is built, Then nothing is sent until tomorrow at the chosen time (Reference sends immediately; this is the deliberate fix).
- **Source refs:** `app/Services/CampaignScheduleSweeper.php`, `app/Http/Controllers/WaCampaignsController.php` (`fireScheduledCampaign`), `app/Http/Controllers/BroadcastsController.php` (`store`, `dispatchToBridge`), `app/Models/WpCampaign.php`.
- **Port notes:** shared with the scheduled-queue-warmer, campaigns and broadcasts domains; record the SMS-specific differences (schedule honoured for broadcasts, recurring idempotency) there.

### TW-SMS-021 — Retries and resume: broadcast sweeper, manual retry, stalled campaign rescue

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-SMS-017, TW-SMS-019
- **Summary:** Failed SMS broadcast recipients are retried automatically a limited number of times and on demand; a campaign stuck mid-send is picked up again. There is no retry inside a single SMS send.
- **Actors & access:** workspace members for the manual retry; the system for the sweepers.
- **UX & screens:** the broadcast detail page has a "Retry failed" action (shared UI).
- **Endpoints:**

| Method uri                        | Route name                   | Controller@action                | Middleware                      | Request fields | Response                                                         |
| --------------------------------- | ---------------------------- | -------------------------------- | ------------------------------- | -------------- | ---------------------------------------------------------------- |
| POST broadcasts/{id}/retry-failed | user.broadcasts.retry-failed | BroadcastsController@retryFailed | web, auth, workspace.role:admin | none           | JSON `{ok, retried, status, message}`; 400 `no_failed` when none |

- **Data:** `broadcast_contacts.status` (`failed` or `undelivered` reset to `pending`, `error_message` and provider id cleared); `broadcasts.send_attempts`, `next_attempt_at`; `wp_campaign_contacts.status`.
- **Rules & edge cases:**
  1. Manual retry: all recipients of the broadcast in `failed` or `undelivered` are reset to `pending`, the broadcast goes back to `processing`, and the SMS runner runs for just those contact ids (TW-SMS-017). Message: "Retrying N failed recipients." With none: HTTP 400 "No failed recipients to retry."
  2. Automatic retry (broadcast sweeper, on the 30 s heartbeat, under a lock): picks broadcasts created in the last 7 days, not in `draft`, `cancelled` or `scheduled`, that still have `failed` or `undelivered` recipients and whose `next_attempt_at` is empty or past; up to 20 per tick. Each is retried until `send_attempts` reaches the broadcast max attempts (default 3, per workspace or global override key `broadcast_retry_attempts`); the wait before the next attempt is `min(3600, base x 2^(attempt-1))` seconds with base 60 by default (`broadcast_retry_backoff_sec`). Attempts and the next time are recorded before dispatch so a crash cannot loop.
  3. QUIRK: the sweeper retries EVERY failure, including permanent ones (invalid number, the recipient replied STOP at Twilio, DLT rejection), up to the attempt cap, paying the provider for each doomed attempt.
  4. Campaigns: the SMS runner does not use the per-recipient attempt counter or backoff, so failed SMS campaign recipients are not auto-retried by that path. They are retried only if the campaign is re-fired (stalled-run rescue: a campaign `running` for more than 45 s with recipients still `queued`, `pending` or `failed` below the cap is flipped back to `scheduled` and due now, and the next sweep re-runs it, now including the previously failed rows because the re-fire excludes only terminal success rows).
  5. Transport level: no retry, no backoff on 429 or 5xx. One attempt, then the recipient is failed with the provider's text.
  6. Throttling and batching: none anywhere in the SMS path (TW-SMS-017 rule 6). Twilio per-account and per-number throughput limits, MSG91 DLT scrubbing delays and carrier caps are not respected; the documentation page claims Threadwise "paces broadcasts/campaigns to the provider's limits" and that is not true for SMS (docs-only claim). The status callback route is rate limited to 240 requests a minute per client.
  7. A retry run overwrites the broadcast counters (TW-SMS-017 rule 7).
  8. A retry re-checks the monthly cap but not the opt-out flag (a contact who opted out after the broadcast was created is retried).
- **Async & events:** the two sweepers; a locked cache key prevents overlap.
- **External systems:** Twilio or MSG91 on each retried send.
- **Settings:** `broadcast_retry_attempts` (default 3), `broadcast_retry_backoff_sec` (default 60), per-workspace overrides, `campaign_retry_attempts` (default 3, used by the rescue).
- **Acceptance criteria:**
  - Given a broadcast with 2 failed recipients, When "Retry failed" is pressed, Then only those 2 are re-sent and the broadcast leaves `processing` with a final status.
  - Given a failed recipient and attempts below the cap, When the sweeper ticks after the backoff, Then it is retried; Given the cap is reached, Then it is left for manual review.
  - Given a broadcast with no failed recipients, When retried, Then HTTP 400 "No failed recipients to retry."
  - Given a campaign killed mid-send, When more than 45 s pass, Then it is re-armed and finishes without re-sending the done recipients.
- **Source refs:** `app/Services/BroadcastSweeper.php`, `app/Services/CampaignScheduleSweeper.php`, `app/Services/RetryPolicy.php`, `app/Http/Controllers/BroadcastsController.php` (`retryFailed`, `redispatchFailed`).
- **Port notes:** decide, with the reviewer, to skip retrying permanent failures (use the error code from TW-SMS-013) and to add provider-level retry for transient errors with backoff and an idempotency key.

### TW-SMS-022 — Delivery status callback and status mapping (Twilio and MSG91 DLR)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-029
- **Summary:** Providers post delivery reports to one public URL. We map each report to `sent`, `delivered` or `failed` and update the message record and, for campaigns, the campaign recipient row.
- **Actors & access:** Twilio and MSG91 only. No session, no CSRF, no signature check. Throttled to 240 requests a minute.
- **UX & screens:** none; the operator only pastes the URL into the MSG91 panel (Twilio gets it per message).
- **Endpoints:**

| Method uri          | Route name | Controller@action          | Middleware          | Request fields                                                                                        | Response                     |
| ------------------- | ---------- | -------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| POST api/sms/status | sms.status | SmsStatusController@handle | api, throttle:240,1 | Twilio: MessageSid or SmsSid, MessageStatus or SmsStatus, ErrorCode, ErrorMessage; MSG91 shapes below | empty body, HTTP 204, always |

- **Data:** reads and writes the outbound message record by provider message id (TW-SMS-029); updates the campaign recipient row whose `whatsapp_message_id` equals the id.
- **Rules & edge cases:**
  1. Twilio fields: id `MessageSid` (else `SmsSid`), status `MessageStatus` (else `SmsStatus`).
  2. MSG91 fields (used when either of the above is missing): payload may be wrapped in `data`; id `requestId` or `request_id`; status `status` or `deliveryStatus`; or a nested `report` that is a string (the status) or a list whose first entry holds `status`, `deliveryStatus` or `desc` (and the id when none at the top).
  3. No id or no status: HTTP 204 and nothing else.
  4. Status mapping, evaluated on the lower-cased trimmed text: exact Twilio words `sent` to sent, `delivered` to delivered, `undelivered` to failed, `failed` to failed. Otherwise failed if the text is one of the codes `2`, `5`, `6`, `9`, `13`, `17`, `25`, or contains `fail`, `undeliv`, `reject`, `expire`, `block` or `ndnd`; else delivered if the text is `1` or contains `deliv` (this catches MSG91 "DELIVRD" and "delivered"); else sent if it contains `sent`; anything else (queued, sending, accepted, submitted, scheduled, canceled, unknown numeric codes) records nothing and returns 204. Failed is checked before delivered so "undelivered" cannot read as delivered.
  5. QUIRK: any status text containing "deliv" is delivered, including Twilio's `delivery_unknown` and `partially_delivered`, so those read as delivered. The MSG91 code list is described in the code as account-dependent and matched defensively; treat it as unverified against a live account.
  6. Message record: set the new status; on delivered set `delivered_at` once (only if empty); on failed append the text "<ErrorCode> <ErrorMessage>" (Twilio fields only, blank for MSG91) to the record's error. The lookup takes the NEWEST record with that provider id.
  7. Campaign row: matched on the provider id; set the mapped status; `delivered_at` once on delivered; on failed the error becomes "<ErrorCode> <ErrorMessage>" or "SMS undelivered"; then the campaign's aggregate counters are recomputed.
  8. No ordering guard: callbacks can arrive out of order (Twilio does not guarantee order), and a late `sent` overwrites `delivered`. QUIRK; the port should only move forward (queued, sent, delivered or failed; never back).
  9. No signature or secret verification on this route, unlike the Twilio request-signature check Reference does on the (dropped) inbound route. Anyone who knows a message id can flip its status. The port should verify `X-Twilio-Signature` (HMAC-SHA1 of the full https URL plus the sorted POST fields, keyed with the sender's auth token, base64, constant-time compare) and require a per-sender secret token in the URL path for MSG91.
  10. Never fails: any exception is logged and the response is still 204 (Twilio retries hard and disables a failing webhook).
  11. The MSG91 DLR URL must be set in the MSG91 panel by the operator; the hub shows it. No receipts arrive otherwise and every MSG91 message stays `sent`.
  12. The mapped statuses reach the broadcast recipient rows NOT AT ALL (TW-SMS-023).
- **Async & events:** the callback is synchronous; the port should enqueue the update.
- **External systems:** Twilio status callbacks (per message, set at send time); MSG91 DLR webhook (set manually).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Twilio callback `MessageStatus=delivered`, When received, Then the message record becomes delivered with a delivered time and the response is 204.
  - Given `MessageStatus=undelivered` with `ErrorCode=30003`, When received, Then the record is failed and the error "30003 ..." is stored.
  - Given an MSG91 callback `{requestId, status:"DELIVRD"}`, When received, Then the record is delivered.
  - Given `MessageStatus=queued`, When received, Then nothing changes and the response is 204.
  - Given an unknown message id, When received, Then 204 and no change.
  - Given a malformed body, When received, Then 204.
- **Source refs:** `app/Http/Controllers/Sms/SmsStatusController.php`, `routes/sms.php`, `bootstrap/app.php` (CSRF exemption of `api/sms/*`).
- **Port notes:** public route in `apps/api/src/modules/channel-sms/webhooks/` (webhook-handler skill): verify, normalise, then update through the outbox so analytics refresh asynchronously. Look up the record by `(provider, provider_message_id)` with an index; the tenant is derived from the record, not the request.

### TW-SMS-023 — Delivery roll-up into campaign analytics (and the broadcast gap)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-SMS-022
- **Summary:** Delivery reports feed the SMS campaign's sent, delivered and failed counters. Broadcasts do not get them.
- **Actors & access:** internal; the numbers appear on the campaign pages.
- **UX & screens:** the campaign list and detail analytics (shared). The documentation says broadcasts also show delivered and a failure-reason breakdown; only campaigns do.
- **Endpoints:** none.
- **Data:** `wp_campaign_contacts.status`, `delivered_at`, `error_message`; `wp_campaigns` aggregate columns.
- **Rules & edge cases:**
  1. A delivered report moves the recipient to `delivered` with a delivered time; a failed report moves it to `failed` with the error; then the campaign counters are recomputed (TW-SMS-019 rule 5).
  2. A recipient that failed after being accepted still counts in `sent_count` (it has a send time) and is also failed; the KPI relies on that.
  3. QUIRK (defect): the callback does not touch `broadcast_contacts`, although broadcast sends store the provider id in the same column. Broadcast recipients therefore stay `sent` forever and `delivered_count` and the failure breakdown never fill in from SMS delivery reports. The port must update broadcast recipients too.
  4. There is no "read" state for SMS (the provider cannot report it).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an SMS campaign and a delivered callback for one recipient, When processed, Then the campaign's delivered count increases by one.
  - Given an SMS broadcast and a delivered callback, When processed in the port, Then the broadcast recipient becomes delivered (a deliberate fix of the Reference gap).
- **Source refs:** `app/Http/Controllers/Sms/SmsStatusController.php`, `app/Models/WpCampaign.php`.
- **Port notes:** one recipient-status writer shared by both composers: the status callback resolves the message record and updates whichever parent it belongs to.

### TW-SMS-024 — Opt-out suppression on the send side

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** contacts-attributes-tags
- **Summary:** Contacts flagged as unsubscribed are never sent SMS. Capturing a STOP reply is not possible in a send-only product; the flag is set manually or by other channels.
- **Actors & access:** internal at send time; the flag is edited in the contacts domain.
- **UX & screens:** none specific. The broadcast composer's error mentions opted-out contacts are skipped.
- **Endpoints:** none.
- **Data:** `contacts.is_unsubscribed` (boolean, nullable; null counts as subscribed) and `contacts.unsubscribed_at`.
- **Rules & edge cases:**
  1. Broadcasts: opted-out contacts are removed from the audience when the broadcast is created (TW-SMS-016 rule 5).
  2. Campaigns: the SMS runner drops opted-out contacts at run time (TW-SMS-019 rule 3); `total_recipients` still counts them.
  3. The flag is workspace-wide, not per channel: a contact who said STOP on WhatsApp is also suppressed on SMS, and the reverse.
  4. Recipients typed or imported as manual numbers become contacts and are checked like any other.
  5. Reference sets the flag from an inbound STOP, STOP ALL, UNSUBSCRIBE, UNSUB, QUIT, OPT OUT, REMOVE ME or NO MORE MESSAGES (and re-subscribes on START, UNSTOP, SUBSCRIBE, RESUME, OPTIN and similar). That capture is dropped (TW-SMS-D03). Twilio still enforces STOP on its side for its own numbers: a send to a recipient who replied STOP fails with code 21610 (TW-SMS-013).
  6. QUIRK: that 21610 failure does not set the flag, so every later send retries the contact and fails (and may be billed or counted against the quota only on success). Decision needed (see Open questions).
  7. Reference does not append an unsubscribe line to SMS bodies; compliance copy ("Reply STOP to unsubscribe") is the operator's to write.
- **Async & events:** none.
- **External systems:** Twilio (STOP enforcement).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact with `is_unsubscribed = true`, When a broadcast is built or a campaign runs, Then that contact is not texted.
  - Given a contact with a null flag, When sent to, Then they are texted.
  - Given a Twilio 21610 failure, When recorded, Then the failure reads as the STOP explanation (flagging the contact is a pending decision).
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (`store`), `app/Services/Sms/SmsCampaignRunner.php` (`recipients`), `app/Services/Inbox/OptOutService.php` (dropped part), `app/Services/Sms/Transports/TwilioTransport.php`.
- **Port notes:** use the contacts domain's suppression query, not a copy. If the reviewer approves flagging on 21610, do it through the contacts service with a reason `provider_stop`.

### TW-SMS-025 — Plan gate `access_sms` and the platform switch `sms_enabled`

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** plans-subscriptions-trials
- **Summary:** SMS is a paid channel that must be switched on by the platform admin and granted by the workspace's plan.
- **Actors & access:** platform admin (switch, plan editor), workspace plan (feature).
- **UX & screens:** admin Channel Settings, SMS section: a toggle "Enabled / Disabled" (form field `sms_enabled`) with the explanation and Twilio and MSG91 setup steps (including the US and Canada A2P 10DLC note). In the plan editor: feature checkbox "SMS (Twilio / MSG91)" (`access_sms`) and a numeric field "SMS / month (0 = unlimited)" (`sms_monthly_limit`) in the Messaging caps group. The plan catalogue label reads "SMS (Twilio / MSG91 — inbox, campaigns)" (drop "inbox").
- **Endpoints:** the existing admin provider-settings save and plan save (plans and platform-settings domains).
- **Data:** `packages.access_sms` (boolean, default false), `packages.sms_monthly_limit` (integer, default 0); system setting `sms_enabled` (boolean, default false, description "Enable the SMS channel (Twilio / MSG91). Numbers connect at /devices.").
- **Rules & edge cases:**
  1. Routes under `/sms` carry the `plan:access_sms` gate. For a page load (GET) a missing feature does not redirect: the page renders with a paywall overlay. For any POST or DELETE the action is refused: JSON requests get HTTP 403 `{ok:false, error:"plan_feature_disabled", feature:"access_sms", message:"Your plan doesn't include sms. Upgrade to unlock this feature."}`; page requests are sent back with the same message as a warning.
  2. Connecting a sender enforces the same feature inline (TW-SMS-002) with the message "This feature isn't available on your current plan. Upgrade to unlock it."
  3. The effective value is the workspace override if present, else the plan plus purchased add-ons (booleans OR; numeric caps add up; -1 is unlimited), else the default. Platform admins and workspaces owned by a platform admin bypass every limit. Users with the Super Admin or Admin role bypass too.
  4. Provider callbacks stay un-gated so a downgraded workspace's late delivery reports still land.
  5. `sms_enabled` off hides: the menu item, the More tile, the add-channel card on Devices, the SMS rows in the Channels table, the SMS template channel, the SMS sender lists in the broadcast and campaign builders, and the chooser cards. It does NOT block `/sms`, the routes or already-created senders from sending. The setting is read from a cached system-settings store.
  6. QUIRK: the menu item has no plan-feature key (other channels' items do), so it shows for plans without `access_sms` and then opens a paywalled page.
  7. QUIRK: broadcast and campaign routes check `broadcast` and `campaign`, not `access_sms`.
  8. The monthly limit is stored in the plan editor's validated field list; an earlier omission made the value silently not save, fixed in v1.7.0.
- **Async & events:** the engine cache is flushed on sender change.
- **External systems:** none.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given a plan without `access_sms`, When `/sms` is loaded, Then it shows under the paywall; When a sender is toggled, Then HTTP 403 (JSON) or a warning (page).
  - Given `sms_enabled` off, When any workspace opens the menu, Then SMS is absent; Given it is on and the plan has the feature, Then the page is fully usable.
  - Given a workspace override `access_sms = true` on a plan without it, When used, Then access is granted.
- **Source refs:** `routes/sms.php`, `app/Http/Middleware/EnforcePlanFeature.php`, `app/Services/PlanLimitGuard.php`, `app/Models/Package.php`, `app/Http/Controllers/AdminPagesController.php`, `resources/views/admin/settings/channel-setting.blade.php`, `resources/views/admin/packages/create.blade.php`, `database/migrations/2026_08_16_000700_add_sms_plan_columns_to_packages.php`.
- **Port notes:** the plan columns already exist here (`plans.access_sms`, `plans.sms_monthly_limit` in the plans schema); use `PlanEntitlementService` and read the `sms_enabled` platform setting from the settings domain. Mark any missing flag `blocked on PLAN`.

### TW-SMS-026 — Monthly SMS quota (`sms_monthly_limit`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-029
- **Summary:** A plan can cap outbound SMS per month. The cap is checked when a broadcast or campaign run starts.
- **Actors & access:** internal.
- **UX & screens:** the failed broadcast or campaign shows the plan-limit sentence; there is no usage meter in Reference.
- **Endpoints:** none.
- **Data:** reads the plan cap and counts the workspace's outbound SMS records created since the first day of the current calendar month (server time zone, not a billing period).
- **Rules & edge cases:**
  1. A value of 0 or null means unlimited. A positive value is a count of MESSAGES, not segments (a three-segment text counts once).
  2. Checked once at the start of each runner run: used >= cap blocks the whole run (broadcast or campaign becomes `failed`, nothing is sent). QUIRK: the check is not repeated per recipient, so a single big run can exceed the cap by any amount.
  3. Only recorded outbound SMS count (the inbox mirror in Reference): failed sends are not counted (they create no record); inbound texts are not counted (they are not outbound); a mirror write that fails is not counted.
  4. The message is the shared plan-limit text built from the limit key: "You've reached your plan's limit of N sms monthlies. Upgrade your plan to add more, or delete an existing one to free up space." (the label comes from the key; rewrite as "monthly SMS" in the port, and drop the delete hint because deleting does not free it).
  5. Not checked on the single-message path because there is none in a send-only product. The manual retry and the sweeper retry go through the same check.
  6. Admins bypass (TW-SMS-025 rule 3). A scheduled run has no signed-in user and so is not bypassed.
  7. SMS usage never touches the WhatsApp wallet or the per-message billing engine (TW-SMS-027).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `sms_monthly_limit` on the plan or a workspace override.
- **Acceptance criteria:**
  - Given a cap of 100 and 100 sent this month, When a broadcast is run, Then it becomes `failed` with the plan-limit message and nothing is sent.
  - Given a cap of 100 and 99 sent, When a broadcast of 500 is run, Then all 500 are sent (cap checked once; Reference behaviour; the port may enforce per recipient and record it as a difference).
  - Given a cap of 0, When any run starts, Then there is no limit.
- **Source refs:** `app/Services/Sms/SmsBroadcastRunner.php` (`monthlyOutbound`), `app/Services/Sms/SmsCampaignRunner.php`, `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`.
- **Port notes:** count from the new message log with an index on (org, created_at); use `PlanEntitlementService` and an atomic per-recipient reserve so the cap cannot be overshot. Show a usage meter on the hub.

### TW-SMS-027 — Rate per segment, cost figure and the no-wallet rule

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-SMS-009
- **Summary:** A sender can carry an optional price per segment for the operator's own spend reporting. SMS never charges the platform wallet.
- **Actors & access:** workspace members.
- **UX & screens:** "Rate per segment" and "Currency" fields on the connect form; a "Rate / segment" row on each sender card.
- **Endpoints:** part of POST connect/wa-store/sms.
- **Data:** `meta_json.rate_per_segment` (string or null) and `meta_json.currency` (upper case, default "USD", max 8).
- **Rules & edge cases:**
  1. No wallet or message-billing charge is made for SMS in any path. The only metering is the monthly message cap (TW-SMS-026) and the provider's own bill.
  2. Cost is computed only by the broadcast runner as the run's total segments multiplied by the rate (0 when no rate), rounded to 4 decimals, written to the log and returned. It is neither stored nor shown. The campaign runner computes no cost.
  3. QUIRK: one exception to rule 1: the shared pre-send gate on broadcast creation runs a wallet precheck for the audience size (TW-SMS-016 rule 6), which can refuse an SMS broadcast for a pay-per-message workspace with an empty wallet although nothing would be charged.
  4. Segments counted per run include failed sends (SMS bills on submission).
  5. The documentation states cost is billed by the provider per destination country; the platform has no price list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per sender.
- **Acceptance criteria:**
  - Given a sender with rate 0.0075 USD, When a broadcast of 100 single-segment messages runs, Then the logged cost is 0.75.
  - Given no rate, When a broadcast runs, Then the cost is 0.
  - Given a pay-per-message workspace, When an SMS broadcast runs, Then no wallet debit is written.
- **Source refs:** `app/Services/Sms/SmsBroadcastRunner.php`, `app/Services/Sms/SmsSender.php`, `app/Http/Controllers/WaConnectController.php`, `resources/views/user/sms/index.blade.php`.
- **Port notes:** store `segments` and `cost_minor` per message and total them on the broadcast and campaign summary; that gives the owner a real spend figure (an additive improvement, recorded as a difference). Keep SMS out of the wallet; exempt SMS from the wallet precheck.

### TW-SMS-028 — Entry points: menu, More tile, add-channel card, Channels table rows

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-SMS-025
- **Summary:** Where SMS shows up in the app once the platform switch is on.
- **Actors & access:** workspace members; menu entry in the admin tier.
- **UX & screens:** menu item "SMS" (key `sms`, admin tier) linking to `/sms`; a tile on the More page ("SMS", "Open SMS"); an "SMS" card on the Devices add-channel chooser that opens `/sms`; SMS rows in the Channels table on `/devices` with a "Manage SMS" link and a remove action (provider label "SMS · Twilio" or "SMS · MSG91", status). The tile and card copy mention the inbox ("Texts arrive in the same team inbox as WhatsApp...") and must be rewritten for send-only.
- **Endpoints:** none of its own (links to TW-SMS-001 and TW-SMS-007).
- **Data:** reads the workspace's SMS senders for the Channels table (only when `sms_enabled` is on).
- **Rules & edge cases:**
  1. All entries are hidden when `sms_enabled` is off.
  2. The Devices counters ("shown" and "total") include SMS rows.
  3. The Devices table lists SMS rows with the same remove route as the hub.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `sms_enabled`.
- **Acceptance criteria:**
  - Given SMS on, When the menu renders, Then "SMS" is present for admins and links to `/sms`.
  - Given a connected sender, When `/devices` loads, Then it appears as a row with a Manage SMS link and a remove action.
  - Given SMS off, When the menu and Devices render, Then no SMS entry or row appears.
- **Source refs:** `app/Support/UserNav.php`, `resources/views/user/more/index.blade.php`, `resources/views/user/devices/index.blade.php`, `resources/views/user/devices/_channel_rows.blade.php`, `app/Http/Controllers/DevicesController.php`.
- **Port notes:** the menu item comes from the feature's `nav.ts` (group `channels`); add the plan feature key to it so it hides without `access_sms` (a deliberate fix).

### TW-SMS-029 — Outbound SMS record (what Reference stores per sent message)

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SMS-017, TW-SMS-019
- **Summary:** Reference has no SMS message table. Each successful send is mirrored into the team inbox as an outbound message, and that mirror is what the delivery callback and the monthly cap read. The send-only build needs its own record.
- **Actors & access:** internal.
- **UX & screens:** none in Reference beyond the inbox thread.
- **Endpoints:** none.
- **Data:** Reference mirror: one conversation per workspace and customer number (channel `sms`, key `sms:<digits>`, title `+<digits>`) and one outbound message with the body, status `sent`, a time, and a JSON blob holding the provider message id (under `wa_message_id`), our From number, segments, provider and source (`broadcast` or `campaign`). The blob is what DLR matches on. Mirroring is best-effort: a failure is logged and ignored.
- **Rules & edge cases:**
  1. A record is written only for sends the provider accepted. Failed sends leave only the recipient row.
  2. The record carries no sender id, contact id or broadcast or campaign id; the link back to the broadcast is only through the provider id stored on its recipient row.
  3. The monthly cap counts these records for the month.
  4. In the send-only build the inbox conversation is dropped (TW-SMS-D07); create an `sms_messages` table instead (Data model) written on every attempt (sent and failed), with the provider id, segments, encoding, status and error.
  5. Message text is customer content: store it encrypted or not at all per the platform's retention rules (decision, see Open questions).
- **Async & events:** the callback (TW-SMS-022) updates it.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a successful send, When recorded, Then a message row exists with the provider id, sender, contact, parent, segments and status `sent`.
  - Given a failed send, When recorded, Then a row exists with status `failed` and the translated error (port; Reference writes none).
  - Given a delivery callback for that provider id, When processed, Then the row becomes `delivered`.
- **Source refs:** `app/Services/Sms/SmsBroadcastRunner.php` (`mirrorToInbox`), `app/Services/Sms/SmsCampaignRunner.php`, `app/Models/InboxMessage.php`, `app/Models/Conversation.php`.
- **Port notes:** new table in `packages/db/migrations/??????????????_sms_*.sql` with RLS, composite keys and monthly partitioning (high volume, append-mostly); the `add-migration` skill applies.

### TW-SMS-030 — Sender resolution at send time and in the pickers

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-SMS-002
- **Summary:** How a broadcast or campaign finds the sender it should use, and how the pickers list senders.
- **Actors & access:** internal and the sender pickers.
- **UX & screens:** the "Send from" picker in the broadcast composer and the sender picker in the campaign builder list SMS senders with the label "SMS · Twilio" or "SMS · MSG91" (or the label plus digits), keyed `sms:<id>`.
- **Endpoints:** none.
- **Data:** reads the sender rows.
- **Rules & edge cases:**
  1. Picker rows: connected SMS senders of the workspace, only when `sms_enabled` is on, and only when the caller asks for the SMS channel (SMS is never included in a WhatsApp picker). Each row carries the key `sms:<id>`, the digits of the From value, the label (stored label, else "SMS · <digits>").
  2. Saving a broadcast or campaign validates the key against that same list; an unknown key is dropped.
  3. At run time: the sender is the stored row id; if the row no longer exists the workspace's primary-then-oldest connected SMS sender is used. A stored sender that exists but is not connected is NOT replaced: the run fails (TW-SMS-006 rule 4).
  4. The runner looks the sender up by id without a workspace filter. QUIRK: a forged id could in principle point at another tenant's sender if it ever reached the runner; the save step prevents it today. The port must scope by org.
  5. Inbound-by-number matching (matching a text's To number to a sender by digits) is dropped (TW-SMS-D01).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `sms_enabled`.
- **Acceptance criteria:**
  - Given two connected senders, When the SMS composer opens, Then both are listed; a deactivated one is not.
  - Given a campaign whose sender was deleted and another sender exists, When it runs, Then the other sender is used.
  - Given a campaign whose sender is deactivated, When it runs, Then it fails with "No sendable SMS number connected".
- **Source refs:** `app/Services/WorkspaceEngine.php` (`senders`, `senderForKey`), `app/Services/Sms/SmsSender.php`, `app/Http/Controllers/BroadcastsController.php`, `app/Http/Controllers/WaCampaignsController.php`.
- **Port notes:** a small `SmsSenderResolver` in the module, used by the composers' option lists and the runners; always tenant-scoped.

## Dropped by owner decision (send-only)

The project owner decided that SMS in Threadwise is send-only. The following exist in Reference but are NOT built. No acceptance criteria. Listed so the parity tracker marks them intended differences, not defects.

| Id         | What Reference does                                                                                                                                                                                                                                                                                                                                                                                                                              | Reference locations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-SMS-D01 | Inbound webhook `POST api/sms/inbound` (throttled 240 a minute, CSRF-exempt): reads Twilio fields (To, From, Body, MessageSid, NumSegments) or probes MSG91 field-name variants, finds our sender by the To number matched on digits, verifies `X-Twilio-Signature` when present (HMAC-SHA1 of the https URL plus sorted POST fields, 403 on mismatch), ignores empty bodies, always answers an empty TwiML `<Response/>` and never returns 500. | `app/Http/Controllers/Sms/SmsWebhookController.php`, `routes/sms.php`, `bootstrap/app.php`, `app/Services/Sms/SmsSender.php` (`byNumber`, `webhookUrl`)                                                                                                                                                                                                                                                                                                                                                               |
| TW-SMS-D02 | Inbound to inbox: find or create the conversation (channel `sms`, key `sms:<digits>`), store the inbound message (`received`), bump last-inbound time, preview and unread count, reopen a resolved thread, capture the sender as a contact, fire the `MessageReceived` event.                                                                                                                                                                    | `app/Http/Controllers/Sms/SmsWebhookController.php` (`store`, `thread`), `app/Models/Conversation.php`, `app/Services/Inbox/ConversationResolver.php`                                                                                                                                                                                                                                                                                                                                                                 |
| TW-SMS-D03 | Opt-out capture from a reply: STOP words (stop, stop all, stopall, unsubscribe, unsub, quit, optout, opt out, opt-out, remove me, no more messages; whole-message match after stripping punctuation) set `is_unsubscribed` and `unsubscribed_at`, mirror to campaign recipient rows and send a confirmation; START words re-subscribe. The SEND-side suppression stays (TW-SMS-024).                                                             | `app/Services/Inbox/OptOutService.php`, `app/Http/Controllers/Sms/SmsWebhookController.php`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TW-SMS-D04 | Automation on an inbound text: routing rules, assignment to an AI agent, keyword auto-reply.                                                                                                                                                                                                                                                                                                                                                     | `app/Http/Controllers/Sms/SmsWebhookController.php` (calls `RoutingEngine`, `AiAgentService`, `KeywordReplyDispatcher`)                                                                                                                                                                                                                                                                                                                                                                                               |
| TW-SMS-D05 | Reply from the inbox over SMS: resolves the sender from the last inbound's `To` number (else the first connected sender), sends the text, returns a result for the inbox UI; text only.                                                                                                                                                                                                                                                          | `app/Services/InboxDispatcher.php` (`dispatchSms`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| TW-SMS-D06 | SMS in the unified inbox and the mobile API: the channel tab and filter, the sender dropdown option "SMS", the "engine-agnostic channel" list, the resolver's sender ranking, tick-mark receipts, the mobile app chat, quick-message, device and workspace-selection scopes.                                                                                                                                                                     | `resources/views/user/team-inbox/index.blade.php`, `resources/js/charts/user-team-inbox-index.js`, `app/Http/Controllers/TeamInboxController.php`, `app/Models/Conversation.php`, `app/Services/Inbox/ConversationResolver.php`, `app/Http/Controllers/Api/App/ChatController.php`, `app/Http/Controllers/Api/App/QuickMessageController.php`, `app/Http/Controllers/Api/App/DeviceController.php`, `app/Http/Controllers/Api/App/Concerns/ScopesToSelectedSender.php`, `app/Http/Middleware/ResolveAppWorkspace.php` |
| TW-SMS-D07 | Mirroring each sent broadcast or campaign SMS into an inbox thread (replaced by TW-SMS-029).                                                                                                                                                                                                                                                                                                                                                     | `app/Services/Sms/SmsBroadcastRunner.php` (`mirrorToInbox`), `app/Services/Sms/SmsCampaignRunner.php` (`mirrorToInbox`)                                                                                                                                                                                                                                                                                                                                                                                               |
| TW-SMS-D08 | Receive-path setup UI and copy: the inbound URL panels (hub, admin Channel Settings, MSG91 options box), "A message comes in" steps, the "How it works" steps about the inbox, the two-way column in the docs page, the "Replying in the Inbox" docs section, the "no inbound texts" troubleshooting row and the alphanumeric "no replies" explanation.                                                                                          | `resources/views/user/sms/index.blade.php`, `resources/views/admin/settings/channel-setting.blade.php`, `resources/views/user/devices/_sms_form.blade.php`, `Documentation/pages/channels/sms.html`                                                                                                                                                                                                                                                                                                                   |

Notes for the build: (1) the delivery-status route is kept (TW-SMS-022) and is not the dropped inbound route; (2) Twilio's own STOP enforcement still applies at the provider and surfaces as error 21610; (3) with no inbound route the Twilio "A message comes in" webhook is simply left unset by the operator; (4) the `sms_subscription_status` field some contact screens carry is a contacts-domain field, not SMS-domain.

## Data model

Reference stores SMS senders in the shared WhatsApp provider table and has no SMS message table. This repo has the plan columns already; everything else is new.

- **`wa_provider_configs` (Reference; shared)**: `workspace_id`, `provider` (`waba`, `baileys`, `twilio`, `sms`), `status` (`pending`, `connected`, `disconnected`, `failed`), `credentials_json` (encrypted JSON), `meta_json` (JSON), `phone_number` (string 32, NOT encrypted, the SMS From value), `display_label` (string 64), `connected_at`, `last_health_at`, `is_primary`, warm-up columns, timestamps. SMS rows use: `provider = 'sms'`; `status` connected or disconnected; credentials `{account_sid, auth_token, from_number}`; meta `{sms_provider ('twilio'|'msg91'), sender_id, dlt_template_id, rate_per_segment, currency}`; `is_primary` always false. Uniqueness is by (workspace, provider, phone_number) in application code only. Read by 001, 006 to 008, 010, 016, 017, 018, 019, 030; written by 002, 006, 007.
- **`sms_senders` (port, new)**: `org_id`, `id`, `provider` (`twilio` | `msg91`), `from_value` (varchar 32), `label` (varchar 64), `status` (`connected` | `disconnected` | `needs_attention`), encrypted `account_sid`, encrypted `auth_token`, `sender_id` (varchar 16), `dlt_template_id` (varchar 64), optional `dlt_entity_id` (varchar 64, only if approved), `rate_per_segment` (numeric(12,4) null), `currency` (varchar 8, default `USD`), `connected_at`, `last_error`, timestamps; unique (`org_id`, `provider`, `from_value`); RLS on `org_id`.
- **`sms_messages` (port, new; high volume)**: `org_id`, `id`, `sender_id`, `contact_id`, `source` (`broadcast` | `campaign`), `source_id`, `to_digits`, `body` (encrypted), `encoding` (`GSM-7` | `UCS-2`), `units`, `segments`, `status` (`queued`, `sent`, `delivered`, `failed`), `provider_message_id` (indexed with the provider), `error_code`, `error_text`, `cost_minor`, `sent_at`, `delivered_at`, timestamps; monthly range partition on `created_at`.
- **`packages` (plans domain)**: `access_sms` boolean not null default false; `sms_monthly_limit` integer not null default 0 (0 = unlimited). Already present in this repo.
- **System setting** `sms_enabled` (boolean, default false).
- **Shared with other domains and not owned here**: `broadcasts` and `broadcast_contacts` (statuses used by SMS: broadcast `scheduled`, `processing`, `completed`, `completed_with_errors`, `failed`; recipient `pending`, `sent`, `failed`, `undelivered`; `whatsapp_message_id` holds the provider id), `wp_campaigns` and `wp_campaign_contacts` (recipient `queued`, `sent`, `delivered`, `failed`, `unsubscribed`, `skipped`), `wa_templates` (channel `sms`), `contacts` (`is_unsubscribed`, `unsubscribed_at`, custom attributes), the team-inbox tables (Reference mirror only).
- Cache (Reference): `sms.lookup.<digits>[.c]`, 90 days.

## Cross-domain contracts

- **Consumes:** broadcasts and campaigns (composer, audience resolution, recipient tables, status machine, sweepers: the SMS runners plug in); message-templates (the `sms` template channel and its availability rule); contacts-attributes-tags (recipients, `is_unsubscribed`, custom attributes, workspace attributes for variables); plans-subscriptions-trials (`access_sms`, `sms_monthly_limit`, `device_limit`, `broadcast`, `campaign` and their quotas, `PlanEntitlementService`); platform-settings-branding-storage (`sms_enabled`, public base URL, secret encryption); scheduled-queue-warmer (delayed and repeatable jobs, retry policy keys); whatsapp-cloud-api-waba (the Twilio WhatsApp credentials that Twilio SMS reuses; the shared device-limit count); notifications-activity-audit (audit rows for connect, toggle, remove).
- **Exposes:** an `SmsProvider` port with Twilio and MSG91 adapters; `SmsSenderResolver`; the pure `measureSms(text)` function in contracts; the `sms` channel entry for broadcast and campaign sender lists; outbox events `sms.sender.connected`, `sms.sender.toggled`, `sms.sender.removed`, `sms.message.status_changed`; the public route `POST api/sms/status`.
- **Not exposed (send-only):** any inbound route, inbox adapter, or reply dispatcher.

## Open questions & quirks

- Decision for the owner: the DLT model. Reference holds one DLT template id per sender and passes the whole personalised text as a variable; it has no entity id and no per-template DLT id (TW-SMS-005). Keep, or add `dlt_entity_id` and a template-level DLT id so one sender can serve many approved templates.
- Decision: flag the contact as unsubscribed when a send fails with Twilio code 21610 (recipient replied STOP at the provider). Reference does not (TW-SMS-013, TW-SMS-024).
- Decision: UCS-2 length rule. Reference counts code points, wire counts UTF-16 code units, so emoji are under-counted (TW-SMS-009).
- Decision: retry policy. Reference retries every failed broadcast recipient up to 3 times, including permanent failures (TW-SMS-021). Skip permanent codes?
- Decision: keep or drop the silent fallback to another sender when the chosen sender row was deleted (TW-SMS-007, TW-SMS-030).
- Decision: India promotional quiet hours (TW-SMS-020). Not modelled in Reference.
- Decision: message-body retention for the new `sms_messages` table (TW-SMS-029).
- Defects in Reference that the port must not copy: named merge variables become empty (TW-SMS-014); "send later" on an SMS broadcast sends immediately (TW-SMS-020); delivery reports never reach broadcast recipients (TW-SMS-023); retry runs overwrite broadcast counters (TW-SMS-017); the status callback has no signature check and no ordering guard (TW-SMS-022); the web broadcast composer has no free-text field (TW-SMS-016); A/B, media, header, footer, Smart Delivery and the auto-end date are offered on the SMS campaign screen but ignored (TW-SMS-018).
- The MSG91 integration was never verified against a live account (the transport's own header says so). Request and response shapes, DLR field names and DLR status codes are from public documentation. Plan a sandbox test before launch.
- Twilio `num_segments` is read straight from the create response and trusted over our count; whether Twilio fills it at creation time was not verified, so a 0 would under-count (TW-SMS-011).
- The MSG91 DLR keyword `ndnd` looks like a typo for `ndnc` (the Indian do-not-disturb registry); as read, an "NDNC" report would not map to failed (TW-SMS-022).
- The MSG91 plain route sends no unicode flag, so Indian-language or emoji text may arrive garbled (TW-SMS-012).
- The `bad_credentials` flag is produced by both transports and read by nothing (TW-SMS-010).
- Docs advertise things that do not exist for SMS: Twilio Messaging Service, MSG91 template selection in the campaign builder, throughput pacing, broadcast delivered and failure-reason breakdown, "Two-way inbound" (now dropped by design).
- The hub copy and the admin and More-page copy still talk about the inbox; they need a send-only rewrite (TW-SMS-001, TW-SMS-025, TW-SMS-028).
- The menu item is not hidden on plans without `access_sms` (TW-SMS-025 rule 6).
- The lookup cache is shared across workspaces (TW-SMS-008).
- Reference's cost figure is computed and discarded (TW-SMS-027).
- `resources/js/charts/user-sms.js` is the only SMS script; there is no segment counter on any composer in Reference.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET sms",
    "POST sms/lookup",
    "POST sms/{id}/toggle",
    "DELETE sms/{id}",
    "POST connect/wa-store/sms",
    "POST api/sms/status",
    "POST api/sms/inbound"
  ],
  "controllers": [
    "app/Http/Controllers/Sms/SmsSettingsController.php",
    "app/Http/Controllers/Sms/SmsStatusController.php",
    "app/Http/Controllers/Sms/SmsWebhookController.php"
  ],
  "services": [
    "app/Services/Sms/Contracts/SmsTransport.php",
    "app/Services/Sms/SmsBroadcastRunner.php",
    "app/Services/Sms/SmsCampaignRunner.php",
    "app/Services/Sms/SmsClient.php",
    "app/Services/Sms/SmsLookup.php",
    "app/Services/Sms/SmsSegments.php",
    "app/Services/Sms/SmsSender.php",
    "app/Services/Sms/Transports/Msg91Transport.php",
    "app/Services/Sms/Transports/TwilioTransport.php"
  ],
  "models": ["WaProviderConfig"],
  "tables": ["wa_provider_configs"],
  "views": [
    "resources/views/user/devices/_sms_form.blade.php",
    "resources/views/user/sms/index.blade.php"
  ],
  "js_assets": ["resources/js/charts/user-sms.js"],
  "misc_files": [
    "routes/sms.php",
    "database/migrations/2026_08_16_000700_add_sms_plan_columns_to_packages.php",
    "database/seeders/SmsShowcaseSeeder.php"
  ],
  "doc_pages": ["Documentation/pages/channels/sms.html"],
  "feature_map": {
    "TW-SMS-001": ["GET sms"],
    "TW-SMS-002": ["POST connect/wa-store/sms"],
    "TW-SMS-006": ["POST sms/{id}/toggle"],
    "TW-SMS-007": ["DELETE sms/{id}"],
    "TW-SMS-008": ["POST sms/lookup"],
    "TW-SMS-022": ["POST api/sms/status"],
    "TW-SMS-D01": ["POST api/sms/inbound"]
  }
}
```
