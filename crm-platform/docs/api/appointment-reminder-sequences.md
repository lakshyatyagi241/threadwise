# API: appointment reminder sequences

BL-420 to BL-429. A booking type's reminders are an ordered **sequence** of steps shown as a timeline: the confirmation, the 24 hour, 2 hour and
15 minute reminders, the after-visit message, the no-show message and a rebook (recall) message. Each step has its own channel order with automatic
fallback, its own message, skip rules and a delivery record that says why a channel was used or skipped. The first version (one rule = N minutes
before or after) is described in [appointments-booking.md](appointments-booking.md); this page is what changed. Code map:
[wiring/appointments-reminder-sequences.md](../threadwise-port/wiring/appointments-reminder-sequences.md). Base path `/v2`; errors are
`application/problem+json` with a stable `code`. Every route needs the plan feature `appointment_booking` (422 `PLAN_FEATURE_LOCKED` otherwise).

## SMS is gone from appointment messages (BL-420)

The channels of an appointment message are `whatsapp` and `email`; `voice` is reserved and cannot be switched on ("coming with the Voice bot").
`PUT /appointment-channels/sms` and a rule listing `sms` are `422`. The migration `20270320090000_appt_reminders_sms_removed.sql` is expand-only and
loses nothing: SMS is removed from every stored rule's channel list; a rule that listed only SMS becomes email-only when the workspace has email
switched on for appointment messages, otherwise it is switched **off** (channels `whatsapp, email`); both carry `notice = "sms_removed"` until the
owner saves the step again; the SMS channel setting is switched off (the row stays as history). Old `sms` values stay readable in the delivery
records of past runs. SMS for broadcasts and one-time codes is a different product and is not touched.

## The steps

`booking_reminders` gained `step_kind`; `kind` gained the value `event` (migration `20270320090100_appt_reminder_sequence.sql`).

| `stepKind`     | `kind`   | `offsetMinutes`                  | When                                                                                                  | Default message kind |
| -------------- | -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `confirmation` | `event`  | 0 (fixed)                        | right after the booking is confirmed                                                                  | `confirmation`       |
| `reminder_24h` | `before` | 1440                             | 24 hours before the start                                                                             | `reminder`           |
| `reminder_2h`  | `before` | 120                              | 2 hours before                                                                                        | `reminder`           |
| `reminder_15m` | `before` | 15                               | 15 minutes before; **online bookings with a join link only** (skipped as `no_join_link` otherwise)    | `reminder`           |
| `reminder`     | `before` | 1 to 43,200                      | any other time before the start                                                                       | `reminder`           |
| `after_visit`  | `after`  | 1 to 43,200 (2 hours by default) | after the END                                                                                         | `follow_up`          |
| `no_show`      | `event`  | 1 (fixed)                        | when the visit is marked no-show                                                                      | `no_show`            |
| `rebook`       | `after`  | up to 525,600 (a year)           | N days after a **completed** visit; marketing; off by default; plan feature `appointment_rebook_steps` (upgrade tier, default off) | `rebook`             |

At most **5 timed steps** (`before` and `after`) per booking type; the two event steps come on top (`422` otherwise). `(stepKind, kind, offsetMinutes)`
is distinct within a type. `stepKind` may be left out of the input: it is read from the kind and the offset (1440 before = the 24 hour reminder).

Input fields added to a reminder (`PATCH /booking-types/:id` `reminders[]`, `POST` the same): `stepKind`, `buttonsEnabled` (Confirm / Reschedule / Cancel
quick replies on a WhatsApp reminder, `before` steps only; plan feature `appointment_confirm_buttons`), `skipIfConfirmed` ("skip Reminder 2 if already
confirmed"), `undeliveredFallbackMinutes` (5 to 720, null = off; default 30 when a pack sets it), `libraryTemplateId` (an email message of the
library, read when the message is sent), `serviceLabel` (up to 40 characters: the word used instead of the service's name, so a clinic can say "your
appointment"), and `packKey` / `packVersion` (set when a pack made the step; the editor sends them back unchanged). Output adds `waTemplateStatus`
(`draft | pending | approved | rejected`, read live from the template, never copied), `waTemplateName`, `notice` and the fields above.

### Skip rules and the fallback

- A cancel, a decline, a move or a no-show stops every waiting run of the booking (`cancelled`, with `booking_cancelled | booking_declined | rescheduled |
  booking_no_show`). A step in a different state at delivery time is re-checked against the booking as it is **now**.
- Never at or after the start, except `after_visit`, `no_show` and `rebook` (they come after it). The booking was made too close to the step's time: the
  step is not claimed (its moment is not later than the booking's `armed_at`).
- **Quiet hours HOLD**, never deny: the run waits (`held`, `quiet_hours`) with its channel order intact and does not move to email because of a hold;
  a reminder the hold would push to within five minutes of the start is skipped (`quiet_hours_too_late`).
- Fallback order: the step's channels in order (default `whatsapp`, then `email`). A channel that is **skipped** (no number or address, no consent,
  opted out, the WhatsApp template not approved yet, no free-text window) or that **fails** hands over to the next. The first channel that sends wins; a
  contact never gets two copies. If the WhatsApp message is handed over and then fails, or is not delivered within `undeliveredFallbackMinutes`, the
  next channel sends it (`not_delivered`, `send_failed`).
- Every run records `attempt_log`: `[{ "channel": "whatsapp", "status": "skipped", "reason": "template_unavailable" }, { "channel": "email", "status": "sent", "reason": null }]`.
  Codes only, never an address, a number or text. `GET /appointments/:id` returns it as `reminders[].attempts` (with `stepKind`, `delivery` =
  `unknown | delivered | failed | undelivered`); the appointment drawer shows it in words.
- Reason codes (new): `already_confirmed`, `no_join_link`, `already_rebooked`, `visit_not_completed`, `plan_feature_locked`, `not_delivered`, `send_failed`.
- Email is used automatically when the contact has no WhatsApp number or no consent, the WhatsApp template is not approved yet, the send fails or the
  message is not delivered in time. A **rebook** is skipped when the contact has booked again (`already_rebooked`).

## Packs (BL-424)

Seven predefined sequences (versioned data in `reminder-packs.data.ts`, `PACKS_VERSION`): `clinic`, `dental`, `salon_spa`, `property_visit`,
`sales_meeting`, `fitness_wellness`, `home_auto_service`. Messages in English and Hindi (Hindi is a **machine draft**; `machineDrafted: ["hi"]`).
WhatsApp bodies use the fixed numbered order name, service, date, time, place, join link, manage link; email may also use `{{host_name}}`,
`{{host_phone}}` and `{{map_link}}` (the host's profile phone and a map search link for an address). The clinic and dental packs set
`serviceLabel` so no message names the service ("your appointment"). Categories: `UTILITY` for the confirmation, reminders and the no-show message;
`MARKETING` for `after_visit` and `rebook` (the consent gate applies).

| Method and path                                | Permission                    | What |
| ---------------------------------------------- | ----------------------------- | ---- |
| `GET /appointment-reminder-packs`              | `record.booking-types.read`   | the seven packs: steps (time, switch, buttons, channels, category), languages, `machineDrafted` |
| `POST /appointment-reminder-packs/:key/preview`| `record.booking-types.read`   | `{ bookingTypeId, language }` -> per step `add | replace | unchanged`, the current rule, the email text, the WhatsApp text, the template name and its live status (`new` when none), `kept` (steps the pack does not touch), `timedSteps`, `blocked` (`cap_exceeded`), `needsConfirm`. Writes nothing. |
| `POST /appointment-reminder-packs/:key/adopt`  | `record.booking-types.update` (+ `tpl.templates.create`, `tpl.templates.sync` for the WhatsApp messages) | `{ bookingTypeId, language, confirmReplace, submitToMeta }`. `409` when a step would be replaced and `confirmReplace` is not true (nothing is written); `422` over the cap. Idempotent key honoured. |

Adopting creates, **once per workspace** and shared by every booking type: an email library message per step (`predefined_key = pack:<pack>:<step>`,
active at once) and a WhatsApp template `appt_<pack>_<step>_<lang>` as a draft, then submitted to Meta through `TemplatesService` unless
`submitToMeta` is false; the library row links to it and its status is read live by the existing logic. Then it saves the type's steps through the
booking type's own update (so the editor's rules apply). Until a template is approved the step sends by **email** (`template_unavailable` in the
log); the screen says "WhatsApp pending approval". A channel the owner has not switched on is left out of the step, and a step with no usable channel is
saved **off**. The rebook step is saved off on a plan without `appointment_rebook_steps`; the buttons are left out of the template on a plan without
`appointment_confirm_buttons`. Without a connected Cloud API number no WhatsApp template is created (email only). A template Meta or the plan refuses
is reported in `templates[].metaError` and the step stays on email.

## Email test (BL-425)

`POST /booking-types/:id/reminders/:reminderId/test-email` (`record.booking-types.update`, 202). Email only; there is no WhatsApp test. Sends the step with
sample values to the **signed-in user's own address** (`{ status: "queued", sentTo: "a***@example.com" }`; `skipped` when the user has no address).
The request is an outbox event (`appointment.reminder_test_requested`, ids only); the worker sends it with the subject prefixed `[Test]` (quiet hours
and the customer consent check do not apply, the owner's email channel switch does) and the result arrives as the notification
`appointment_reminder_test`.

## Confirm, Reschedule and Cancel buttons (BL-426)

The 24 hour reminder's WhatsApp template carries three quick-reply buttons. Each button's payload is a **signed one-time token**
(`ap1:` + the authenticated encryption of the run and a random nonce kept on `appointment_reminder_runs.reply_state`; at most 256 characters). A tap
comes back through the existing inbound pipeline (`InboundMessageHooks`, a `first` listener in the worker; no new webhook) as the stored message's
`buttonPayload`.

| Button     | Does                                                                                                                                                                                             | Answer in the thread |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Confirm    | sets `appointments.customer_confirmed_at` (a second fact next to the business confirming), an audit row, the event `appointment.customer_confirmed`, a line on the contact's timeline; skips a "skip if already confirmed" reminder | "your appointment on ... is confirmed" |
| Cancel     | cancels through the booking service exactly as the customer's cancel on the manage page (not after the start, the cancel fee is recorded as the type says), waiting reminders stop, the host is told (`appointment_cancelled_by_customer`) | "has been cancelled" |
| Reschedule | changes nothing; replies with the manage link                                                                                                                                                    | the link |

Security: a token that is not ours, edited or from another workspace is ignored (and no bot answers it); the tap must arrive in the thread of the
contact the booking belongs to (a forwarded button does nothing); a button is used once (a second tap gets the same answer and does nothing again);
it expires at the booking's start (`expired`); a booking that is cancelled, declined, completed or no-show cannot be changed from a button
(`not_available`). The answer is in the language of the step's template (English or Hindi).

## Report (BL-429)

`GET /appointment-reminder-report?bookingTypeId&from&to` (`record.booking-types.read`). Window: the due time of the steps, default the last 30 days.
Per booking type: `appointments`, `confirmationRate`, `cancelRate`, `noShowRate`; per step: `sent`, `delivered` (what the provider reported for a WhatsApp
message; an email has no delivery report), `failed`, `skipped`, `skippedReasons` (reason code to count) and the three rates over the bookings the step
was sent for. A rate is `null` when nothing was sent. Counts only; no contact, address or message text.

## Plan features (BL-428)

`appointment_confirm_buttons` (Confirm / Reschedule / Cancel buttons) and `appointment_rebook_steps` (rebook steps), both `productLine: crm`, listed in the
plan editor with the other appointment features. Since 2026-10-22 both default to **off** and are the **upgrade tier** of the Appointments app; they also need
`appointment_booking`. They are asked when a step is switched on (a plan that lost one still saves everything else; 422 `PLAN_FEATURE_LOCKED`), when a pack is applied
(the locked parts are left out and `withheld` says so), when the buttons are sent and when a rebook step is delivered (`plan_feature_locked`). One function decides
(`ReminderPlan`). Operator how-to, matrix and downgrade rules: [appointment-reminders-packaging.md](appointment-reminders-packaging.md).

## Report additions (2026-10-22)

`GET /appointment-reminder-report` also returns `buttonsIncluded`, and per step `fallbackUsed` (sent on a later channel than the first tried) and `buttons`
`{ confirmed, rescheduled, cancelled }` (taps that did something; `null` when the plan has no buttons). The test email takes an optional `{ "to": "<address>" }`
(default the signed-in user), at most 10 per workspace per hour (429). Each reminder of `GET /appointments/:id` also returns `buttonReplies: [{ action, at }]`.
