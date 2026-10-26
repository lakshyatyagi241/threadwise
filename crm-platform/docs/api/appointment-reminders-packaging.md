# Appointment reminders packaging (operator how-to)

Owner decision 2026-10-22. Same shape as [smart-routing-packaging.md](smart-routing-packaging.md); read that first for how plan defaults, plan rows and
workspace overrides are resolved. The reminder sequences themselves are described in [appointment-reminder-sequences.md](appointment-reminder-sequences.md).

Reminders live inside the **Appointments** first-party Marketplace app (flag `appointment_booking`, owned by the app).

| Part                                                                                                                                                                                                                        | Included with the app (`appointment_booking`) | Upgrade tier (needs its own plan feature)                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Timed WhatsApp + email reminders (confirmation, 24h, 2h, 15m online, after visit, no-show; max 5 timed steps), the 7 predefined packs, the test email, the email fallback, the delivery report, the per-appointment history | yes, no extra flag                            |                                                                                                |
| Confirm / Reschedule / Cancel buttons (and their counts in the report)                                                                                                                                                      |                                               | `appointment_confirm_buttons` ("Appointment reminders: Confirm / Reschedule / Cancel buttons") |
| Rebook (recall) steps                                                                                                                                                                                                       |                                               | `appointment_rebook_steps` ("Appointment reminders: rebook (recall) steps")                    |

Both upgrade flags need `appointment_booking` as well: `ReminderPlan` (`apps/api/src/modules/appointments-booking/reminder-plan.ts`) is the one place that
decides, and it answers "no" when the app flag is off even if the plan row stores `true`. A platform-owned workspace has everything.

## 1. Finding: what the Appointments app grants

Read from `app-grants.ts`, `splitAppPacks`, the seed (`seed-appointments.ts`, `seed-app.config.ts`, migration `20261023090200_mkt_appointments_app.sql`) and the e2e
`marketplace-pricing.e2e.spec.ts` / `seed-appointments.e2e.spec.ts`:

- The Appointments listing's `grantsPlanFeatures` is **`['appointment_booking']` only**. The app's add-on pack therefore stores `{ mkt_appointments: true, appointment_booking: true }`, and
  `splitAppPacks` merges exactly those into the workspace's entitlements while the app is installed and running.
- So **the two flags are plan-level upgrades** (plan Features tab, Chat/CRM line). A workspace that has only the app subscription gets timed reminders and nothing of the upgrade tier:
  the buttons and the rebook step are shown locked, and stay locked.
- This change did not touch the app's grants (no migration, no change to the listing or its pack).
- It is possible without code to sell the upgrade tier through the app instead: since the two flags now default to **false**, `planFeatureOwnableByApp` allows an app to own them
  (it refused a core feature whose default is on). The operator can add them to the listing's "grants plan features"; the next pack then carries them. That is a pricing decision, not part of this change.

## 2. Defaults: what a plan row that lacks the keys now reads

Before: both flags defaulted to **true** (`PLAN_FEATURE_DEFS`), so every plan row without the key granted them. Now both default to **false** and are in `NEW_PLAN_FEATURES_OFF`
(`packages/contracts/src/plans-subscriptions-trials/catalogue.ts`). `resolveFeature` order is unchanged: platform-owned workspace (on), the workspace's override, a plan slug with no
catalogue row (nothing locked), then the plan row: the stored boolean, and **when the row does not store the key, the catalogue default (false)**.

| Plan row state                                             | `appointment_confirm_buttons` / `appointment_rebook_steps` read           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| row stores `true`                                          | on (needs `appointment_booking` too)                                      |
| row stores `false`                                         | off                                                                       |
| row does not store the key (every plan saved before today) | **off** (was on)                                                          |
| workspace on a plan slug with no catalogue row             | open: nothing is locked (unchanged rule, see smart-routing doc section 2) |
| workspace override `features.<key>`                        | wins in both directions                                                   |
| platform-owned workspace                                   | on                                                                        |

No migration was written: the default is a code constant, nothing is stored for old rows, and no data changes. There are no paying clients yet (owner decision), so flipping the
default is allowed. The state of the real-data copy (`crm_owner`) was **not** re-inspected for this change; the smart-routing doc recorded on 2026-10-22 that `plans` was empty and the
two workspaces sat on a slug with no row, which means nothing is locked for them today.

Fresh installs: `seed-auth.ts` seeds Starter with both off, Growth and Scale with both on, only when the slug is missing. A plan created from the plan form starts with both unticked.

### Operator steps

1. Operator console, **Plans**, open (or create) the entry plan, **Features** tab: leave **Appointment reminders: Confirm / Reschedule / Cancel buttons** and **Appointment reminders: rebook (recall) steps** off. Save.
2. For each higher tier: switch both on. Save. (The editor writes every key, so each plan then stores both explicitly.)
3. The Appointments app itself (`appointment_booking`) is priced and attached in **Marketplace**, as before.
4. Operator and test workspaces: mark them platform-owned, or set the workspace overrides `appointment_booking`, `appointment_confirm_buttons`, `appointment_rebook_steps` to on.

## 3. What a workspace sees without the flags

Every locked part is **shown** with a line that names what unlocks it ("part of the Appointments upgrade tier, which your plan does not include") and a link to Plans. Nothing is hidden or silently ignored.

| Part that is locked                      | Web                                                                                                          | API                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons switch on a 24h reminder         | switch disabled, hint + "Upgrade your plan" link; an already-on switch can still be switched off             | saving a step with `buttonsEnabled: true` that was not on before: 422 `PLAN_FEATURE_LOCKED`                                                                                        |
| Rebook step                              | can be added and set up, **On** switch disabled, hint + link                                                 | saving a rebook step switched on (it was not on before): 422 `PLAN_FEATURE_LOCKED`; saved switched off: allowed                                                                    |
| A pack that has buttons or a rebook step | the preview shows the hint per step; after applying, "Left out because of your plan" lists what was left out | `adopt` applies the pack **without** those parts (no buttons in the template, rebook step saved off) and answers `withheld: [{ stepKind, part }]`; `preview` answers the same list |
| Report button columns                    | columns left out, one hint with the link                                                                     | `buttonsIncluded: false`, `steps[].buttons: null` (no counts are made for a part the plan does not have)                                                                           |
| Per-appointment history, button replies  | listed on every plan: they are recorded facts of the booking                                                 | `buttonReplies` is always returned                                                                                                                                                 |

## 4. Downgrade behaviour

Stored rules stay; nothing is deleted. What changes is what is **sent**, checked at send time by the worker through the same `ReminderPlan`:

- A rebook run on a plan without the flag finishes `skipped` with reason `plan_feature_locked` (shown in the appointment history, counted in the report).
- A WhatsApp reminder whose step has `buttonsEnabled` is sent **without our signed button payloads** (`buttonsAllowed` is false), so a tap on it does nothing here. The button labels themselves belong to the Meta template (it keeps its buttons); the owner switches the step's buttons off or picks a template without them. This is the one downgrade case that cannot be made fully clean on the Meta side.
- A tap on a button of a message that was **already sent** keeps working (the customer received it under the old plan); the tokens are still signed, single-use and expire at the start.
- Re-saving a step that already has the part on is allowed (so the owner can still edit its text); only turning it on newly is refused.
- When the flag comes back, the same stored rules send again.

## 5. Permissions matrix

Control x flag x permission x role presets x where configured x behaviour when off. Presets: **Admin** (locked preset, every key), **Agent/Counsellor** (editable front-line preset: `record.booking-types.read`, `record.appointments.read/update` own, `record.appointments.create`). A workspace changes this in its role editor.

| Control / endpoint                                                              | Flag needed                                                             | Permission                                                                                                                    | Admin | Agent / Counsellor | Where configured                                | When the flag is off                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| View steps (timeline) `GET /booking-types`                                      | `appointment_booking`                                                   | `record.booking-types.read`                                                                                                   | yes   | yes                | Settings, Appointment settings, Reminders       | whole app locked (422 `PLAN_FEATURE_LOCKED`, `app_not_installed` reason when subscribed but not installed) |
| Edit steps, save reminders `PATCH /booking-types/:id`                           | `appointment_booking`                                                   | `record.booking-types.update`                                                                                                 | yes   | no                 | same                                            | as above                                                                                                   |
| Buttons switch                                                                  | + `appointment_confirm_buttons`                                         | `record.booking-types.update`                                                                                                 | yes   | no                 | step options of a 24h reminder                  | disabled with hint + link; API 422 when turned on                                                          |
| Rebook step On                                                                  | + `appointment_rebook_steps`                                            | `record.booking-types.update`                                                                                                 | yes   | no                 | timeline, "Rebook message"                      | On disabled with hint + link; API 422 when turned on                                                       |
| Packs list / preview `GET /appointment-reminder-packs`, `POST .../:key/preview` | `appointment_booking`                                                   | `record.booking-types.read`                                                                                                   | yes   | yes                | "Ready-made sequences"                          | preview lists `withheld` parts                                                                             |
| Pack apply `POST .../:key/adopt`                                                | `appointment_booking` (+ either flag for its parts)                     | `record.booking-types.update`; WhatsApp messages also need `tpl.templates.create`, and `tpl.templates.sync` to submit to Meta | yes   | no                 | "Ready-made sequences"                          | applies without the locked parts, answers `withheld`                                                       |
| Test email `POST /booking-types/:id/reminders/:rid/test-email`                  | `appointment_booking`                                                   | `record.booking-types.update` (10 per workspace per hour)                                                                     | yes   | no                 | "Send a test email" on a saved step             | n/a (included with the app)                                                                                |
| Delivery report `GET /appointment-reminder-report`                              | `appointment_booking`; button counts need `appointment_confirm_buttons` | `record.booking-types.read`                                                                                                   | yes   | yes (counts only)  | Settings, Appointment settings, Reminder report | button columns omitted, `buttonsIncluded: false`                                                           |
| Per-appointment history `GET /appointments/:id`                                 | `appointment_booking`                                                   | `record.appointments.read` (record scope)                                                                                     | yes   | own                | appointment drawer                              | n/a                                                                                                        |
| Customer button tap (inbound worker)                                            | token signed at send time; send needs `appointment_confirm_buttons`     | none (customer, signed one-time token)                                                                                        | -     | -                  | WhatsApp thread                                 | buttons are not attached to new sends; old messages keep working                                           |

## 6. Support checklist

- "The Buttons switch is greyed out": the workspace's plan lacks `appointment_confirm_buttons` (Plans, Features), or the app flag is off. Check for a workspace override.
- "The Rebook step will not switch on": same, with `appointment_rebook_steps`.
- "I applied a pack and the buttons are missing": expected on a plan without the flag; the apply answer lists it under "Left out because of your plan".
- "Reminders stopped after we changed plan": expected for the locked parts only; timed reminders keep going. Rebook runs read "Not sent: your plan does not include this step".
- "The report has no Confirmed / Rescheduled / Cancelled columns": the plan lacks `appointment_confirm_buttons`.
