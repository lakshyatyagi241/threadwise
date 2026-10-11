---
domain: appointments-booking
code: APPT
title: Appointments and booking
threadwise_version: '1.7.0'
sources_read: 38
---

# Appointments and booking

## Overview

Reference lets a business sell time slots. A workspace admin defines **booking types** (services such as "30-min Demo"): duration, start step,
buffers, minimum notice, how far ahead people can book, weekly hours, a per-booking-type time zone, capacity, an optional price or deposit,
a questionnaire, lifecycle messages and reminder offsets. Customers do not book on a web page: a flow node ("Book appointment") runs
inside a WhatsApp conversation, asks which service, which day and which time (nine rows per page), asks the questions, books, and sends a
confirmation with a **manage link** (`/b/manage/{token}`). The customer opens that unauthenticated page to reschedule or cancel. Staff see
one screen (`/appointments`: upcoming 50 and recent past 20, with a Cancel button) and the booking type list and 5-step wizard.

Older code, still routed, is a **single-calendar mode** kept for workspaces that have no booking types: workspace-level settings (Mon-Sun
windows, slot length, buffers, max per day, advance days, one reminder offset, default location), a Google Calendar connection, and the
flow runtime calls `/api/appointments/slots` and `/api/appointments/book` (token-guarded). Google Calendar is optional: free/busy is read
from it, events (and Meet links) are written to it, and a Sheets row can be appended per booking.

Roles and gates: the whole area is admin-tier (`workspace.role:admin`) and URL-gated by the plan flag `access_appointment_booking`
(default on). `appointments_limit` caps bookings per month (0 or empty = unlimited). Reminders and notifications are sent through the
Node WhatsApp bridge (`/api/schedule-message-bulk`), keyed by synthetic negative schedule ids.

Connections: `contacts-attributes-tags` (contact link, questionnaire answers mapped to contact fields), `chat-conversations` (appointments
carry `conversation_id`; the duplicate-conversation merger repoints it), `flow-builder-editor` and `flow-runtime-engine` (the node,
trigger kind `appointment_booked`), `message-templates` (WhatsApp templates picked per event), `whatsapp-devices-baileys` and
`whatsapp-cloud-api-waba` (the sender), `integrations` (Google OAuth, Sheets), `platform-payment-gateways` and `sales-invoices-payments`
(deposit payments), `plans-subscriptions-trials` (flag and monthly cap), `notifications-activity-audit` (the `appointment_booked`
notification toggle, which nothing fires), `workspaces-teams-tenancy` (workspace wipe).

What does **not** exist in Reference and is asked for by the port owner (marked `EXT-APPT-nn` below, recorded in
`parity/product-extensions.md`): a public booking page for a service, staff-created appointments, approval-required bookings, a status
machine with staff actions (confirm, decline, complete, no-show, check-in), a database-level double-booking guarantee, ICS download,
counts per status for tabs and a "my appointments" scope, calendar and message **ports** with stub adapters.

## Feature index

| Id          | Feature                                                                 | Status      | Priority | Effort | Depends on    |
| ----------- | ----------------------------------------------------------------------- | ----------- | -------- | ------ | ------------- |
| TW-APPT-001 | Access: admin role, plan flag, URL gate                                 | implemented | P0       | S      |               |
| TW-APPT-002 | Appointments screen: upcoming and recent past                           | implemented | P0       | M      | 001, 039      |
| TW-APPT-003 | Cancel an appointment (staff)                                           | implemented | P0       | S      | 039           |
| TW-APPT-004 | Reschedule an appointment (staff, JSON route, no UI)                    | partial     | P1       | S      | 039           |
| TW-APPT-005 | Booking types list: cards, pause, delete, counts                        | implemented | P0       | S      | 001           |
| TW-APPT-006 | Booking type wizard: create, edit (save everything at once)             | implemented | P0       | L      | 005           |
| TW-APPT-007 | Service details: name, slug, description, location, colour              | implemented | P0       | S      | 006           |
| TW-APPT-008 | Timing and capacity rules                                               | implemented | P0       | M      | 006           |
| TW-APPT-009 | Weekly availability intervals                                           | implemented | P0       | M      | 006           |
| TW-APPT-010 | Date overrides: closed days and special hours                           | partial     | P1       | S      | 009           |
| TW-APPT-011 | Pricing, tax and deposit                                                | implemented | P1       | M      | 006           |
| TW-APPT-012 | Calendar targeting: calendar id, Meet, Sheets                           | implemented | P2       | S      | 006           |
| TW-APPT-013 | Lifecycle message templates (four events)                               | partial     | P1       | M      | 006           |
| TW-APPT-014 | Reminder cadence (offsets)                                              | implemented | P1       | S      | 006           |
| TW-APPT-015 | Questionnaire                                                           | implemented | P1       | M      | 006           |
| TW-APPT-016 | Stateless slot preview from a draft                                     | implemented | P1       | S      | 017           |
| TW-APPT-017 | Slot engine: candidate grid, buffers, notice, horizon, time zones       | implemented | P0       | L      | 008, 009      |
| TW-APPT-018 | Slot engine: overrides, reservations, capacity seats                    | implemented | P0       | M      | 010, 017, 020 |
| TW-APPT-019 | Slots API for the chat flow (days then times, 9 per page)               | implemented | P0       | M      | 017           |
| TW-APPT-020 | Reserve a slot (ten-minute soft lock)                                   | implemented | P1       | S      | 018           |
| TW-APPT-021 | Book a booking-type slot (hard guard, seats, replay)                    | implemented | P0       | L      | 018, 019      |
| TW-APPT-022 | Single-calendar mode: workspace settings screen                         | implemented | P1       | M      | 001           |
| TW-APPT-023 | Single-calendar mode: slots and book API for the flow node              | implemented | P1       | M      | 022           |
| TW-APPT-024 | Public manage page (capability token)                                   | implemented | P0       | S      | 021           |
| TW-APPT-025 | Public reschedule                                                       | implemented | P0       | M      | 024, 019      |
| TW-APPT-026 | Public cancel and the recorded cancel fee                               | implemented | P1       | S      | 024           |
| TW-APPT-027 | Booking payment: pay link and gateway callback                          | dead-code   | P1       | L      | 011, 021      |
| TW-APPT-028 | Google Calendar OAuth: connect, disconnect, calendar list               | implemented | P1       | M      | 001           |
| TW-APPT-029 | Calendar event write: create, Meet link, move, delete, Sheets append    | implemented | P1       | M      | 012, 028      |
| TW-APPT-030 | Reminder scheduling on the Node bridge                                  | implemented | P0       | M      | 014, 021      |
| TW-APPT-031 | Cancellation notification and reminder teardown                         | partial     | P1       | S      | 003, 030      |
| TW-APPT-032 | Lifecycle sweeper: reservations, needs-review, auto-complete            | partial     | P2       | S      | 020           |
| TW-APPT-033 | Questionnaire answers mapped onto the contact                           | implemented | P1       | S      | 015, 021      |
| TW-APPT-034 | The "Book appointment" flow node                                        | implemented | P0       | L      | 019, 021, 023 |
| TW-APPT-035 | Plan monthly cap (`appointments_limit`)                                 | partial     | P1       | S      | 001           |
| TW-APPT-036 | Navigation, dashboard, quick access, workspace wipe, conversation merge | implemented | P2       | S      | 001           |
| TW-APPT-037 | Engine (provider) stamp and scope                                       | implemented | P2       | S      |               |
| TW-APPT-038 | Manage token: unguessable capability                                    | implemented | P0       | S      | 021           |
| TW-APPT-039 | Status model                                                            | partial     | P0       | M      |               |
| TW-APPT-040 | `appointment_booked` flow trigger and notification toggle               | docs-only   | P2       | S      | 021           |

Port extensions (not in Reference; each is a row in `parity/product-extensions.md`): EXT-APPT-01 public booking page, EXT-APPT-02 staff create,
EXT-APPT-03 approval-required, EXT-APPT-04 status machine and staff actions, EXT-APPT-05 database double-booking guarantee,
EXT-APPT-06 ICS, EXT-APPT-07 counts and "my appointments", EXT-APPT-08 calendar and message ports.

## Features

### TW-APPT-001 — Access: admin role, plan flag, URL gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** every staff route under `/appointments` needs the admin workspace role; the booking-type routes (list, wizard, preview) also sit behind the plan middleware; the config `plan_gates.php` gates the whole `appointments` URL prefix on the same flag.
- **Actors & access:** workspace role `admin` (middleware `workspace.role:admin`); plan flag `access_appointment_booking` (package column, default true); platform admins bypass. The nav entry carries `tier: admin` and `feature: access_appointment_booking`, so the menu hides it without the flag. The docs say booking also needs the "Google Calendar" plan feature: only the calendar-connected write path checks `integration_google_calendar`.
- **UX & screens:** a plan-locked workspace sees the upgrade paywall in place of the page.
- **Endpoints:** see each feature. Public routes (`/b/manage/...`) and the Node routes (`/api/...`) are outside the role and plan middleware.
- **Data:** `packages.access_appointment_booking`, `packages.appointments_limit`.
- **Rules & edge cases:**
  1. The `plan:` middleware sits only on the booking-type group; `/appointments`, settings, cancel and reschedule rely on the URL gate and the nav.
  2. `GET /api/appointments/slots` offers slots WITHOUT the plan gate, and `POST /api/appointments/book` explicitly does not enforce the feature flag (it only logs), so a plan without the flag can still book mid-flow. `GET /api/booking/types` and `POST /api/booking/book` DO check the flag at offer time ("offer gate") and answer `{available:false, reason:'feature_off'}`.
  3. No permission keys exist; role admin is the only gate.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan package fields only.
- **Acceptance criteria:**
  - Given a plan without the flag, When an admin opens `/appointments/booking-types`, Then access is refused with the paywall.
  - Given a non-admin member, When they open `/appointments`, Then they are redirected by the role middleware.
  - Given a plan without the flag, When the flow node asks for booking types, Then `{available:false, reason:'feature_off'}` comes back and the node says online booking is not available.
- **Source refs:** routes/web.php:1181-1207, config/plan_gates.php:66-67, app/Support/UserNav.php:182, app/Models/Package.php:109,260, app/Http/Controllers/BookingApiController.php:671-689.
- **Port notes:** `AppointmentBookingGuard` over `PlanEntitlementService` (feature `appointment_booking`, default on); keys `record.appointments.*` and `record.booking-types.*` replace the role check (D-02). Public routes check the flag at offer time like Reference.

### TW-APPT-002 — Appointments screen: upcoming and recent past

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-001, TW-APPT-039
- **Summary:** one page: a left rail (Google Calendar connection status, "booking rules" or "what this does"), header actions (New booking type, Booking types, Settings), a table of upcoming bookings and a short list of recent past ones.
- **Actors & access:** admin role + plan flag.
- **UX & screens:** `resources/views/user/appointments/index.blade.php`. Rail: Google card with Connected / Not connected pill and a Connect link; when connected a card with the legacy booking rules (slot duration, buffer before/after, max per day, advance window, reminder); otherwise three check marks about what the feature does. Table "Upcoming" with a count: When (date, time range and time zone of the appointment), Customer (meta name, phone), Title, Status pill (confirmed green, pending amber, other grey), a Cancel button (confirm dialog) for pending or confirmed rows. Empty state "No upcoming bookings" with a New booking type button. "Recent past" shows at most 10 of the 20 loaded (when, customer, title, status). Flash banners for success and error.
- **Endpoints:**

| METHOD uri       | route name              | Controller@action           | middleware                 | request | response   |
| ---------------- | ----------------------- | --------------------------- | -------------------------- | ------- | ---------- |
| GET appointments | user.appointments.index | AppointmentController@index | auth, workspace.role:admin | none    | Blade page |

- **Data:** upcoming = `starts_at >= now()` and status pending or confirmed, ascending, **limit 50**; past = `starts_at < now()` any status (cancelled, completed, pending that never confirmed), descending, limit 20; both scoped to the workspace and the workspace's engine set. "Connected" means a calendar can be resolved (explicit id, or any stored token falls back to `primary`).
- **Rules & edge cases:**
  1. No pagination, no filters, no search, no status tabs; more than 50 upcoming rows are invisible.
  2. A pending or confirmed appointment whose start has passed is not "upcoming" and shows in past with its stale status. Nothing ever completes it except the sweeper's check-in path (TW-APPT-032).
  3. Times render in the appointment's own `timezone` column (the type's zone at booking), not the viewer's.
  4. The booking-type breadcrumb and type name are not shown: a row carries only its title.
- **Async & events:** none.
- **Acceptance criteria:**
  - Given 60 upcoming bookings, When the page loads, Then 50 show.
  - Given a cancelled booking in the future, When the page loads, Then it is not in Upcoming.
  - Given no bookings, Then "No upcoming bookings" and the New booking type button show.
- **Source refs:** AppointmentController.php:52-82, resources/views/user/appointments/index.blade.php.
- **Port notes:** `GET /appointments` cursor-paged with `scope=upcoming|past|all`, status filter, search, `mine`, and `GET /appointments/counts` for tab badges (EXT-APPT-07, D-07). Calendar connection state comes from the calendar port.

### TW-APPT-003 — Cancel an appointment (staff)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-APPT-039
- **Summary:** the Cancel button posts to `/appointments/{id}/cancel`: the status becomes `cancelled`, the Google event is deleted, the reminder schedule is torn down and the customer is told.
- **Actors & access:** admin role (no plan middleware on this route).
- **UX & screens:** the confirm dialog "Cancel this appointment?" then a redirect back with "Appointment cancelled."
- **Endpoints:**

| METHOD uri                    | route name               | Controller@action            | middleware | request | response             |
| ----------------------------- | ------------------------ | ---------------------------- | ---------- | ------- | -------------------- |
| POST appointments/{id}/cancel | user.appointments.cancel | AppointmentController@cancel | admin      | none    | redirect back, flash |

- **Data:** `appointments.status`; a missing id or another workspace's id is 404. **No status guard:** a completed, already cancelled or no-show appointment is cancelled again (and the customer is notified again).
- **Rules & edge cases:**
  1. The Google event (when both ids are stored) is deleted first, synchronously; a 410 counts as deleted.
  2. After the response: the reminder schedule ids (`-1000000 - id` and eight `-2000000000 - id*100 - n`) are cancelled on the Node bridge, then a cancellation text is scheduled three seconds out with id `-3000000 - id` (TW-APPT-031).
  3. `active_slot_key` is NOT cleared by this route (only the public cancel clears it), so a staff-cancelled booking-type appointment keeps its unique key and the slot stays blocked for future bookings. QUIRK: a staff cancel does not free the slot.
  4. No cancellation reason, no cancel-fee recording on this route.
- **Async & events:** deferred "terminating" callback (Node round-trips); no queue.
- **Acceptance criteria:**
  - Given a confirmed booking, When Cancel is confirmed, Then its status is cancelled and the customer gets the cancellation text.
  - Given an id from another workspace, Then 404.
- **Source refs:** AppointmentController.php:387-435.
- **Port notes:** guarded transition (pending or confirmed only), frees the slot in the same transaction (the exclusion constraint covers active statuses only), `appointment.cancelled` event, audit row, optional reason and notify flag (D-04, D-09).

### TW-APPT-004 — Reschedule an appointment (staff, JSON route, no UI)

- **Status:** partial (route and controller exist, no button anywhere)
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-039
- **Summary:** `POST /appointments/{id}/reschedule` moves an appointment to a new `starts_at` / `ends_at`, updates the Google event in place and re-arms the single legacy reminder.
- **Actors & access:** admin role.
- **Endpoints:**

| METHOD uri                        | route name                   | Controller@action                | middleware | request                          | response                                                                 |
| --------------------------------- | ---------------------------- | -------------------------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------ |
| POST appointments/{id}/reschedule | user.appointments.reschedule | AppointmentController@reschedule | admin      | starts_at, ends_at, notify(bool) | JSON `{ok, appointment_id, previous_starts, starts_at, ends_at, status}` |

- **Rules & edge cases:**
  1. `starts_at` and `ends_at` required, any parseable dates; `ends_at` must be after `starts_at` (422 `{ok:false,error}`); a cancelled or declined appointment is 422 `cannot_reschedule_terminal_state` (completed and no-show are allowed).
  2. **No availability check and no seat check:** any time, in the past, outside the hours, or on top of another booking.
  3. The status is forced to `confirmed` (a pending request is silently approved) and the stored `timezone` is overwritten with the workspace calendar zone, not the booking type's.
  4. `active_slot_key` is not recomputed, so the unique guard still points at the old slot (the new slot is unguarded and the old slot stays blocked). QUIRK.
  5. `notify` (default true) only controls Google's own update email; no WhatsApp reschedule message is sent. Only the legacy single reminder is re-armed (the multi-offset reminders of a booking type are not).
  6. The Google event id is kept and patched (start, end).
- **Acceptance criteria:**
  - Given a confirmed booking, When rescheduled with valid dates, Then the response carries the new times and `status: confirmed`.
  - Given a cancelled booking, Then 422.
  - Given `ends_at` before `starts_at`, Then 422.
- **Source refs:** AppointmentController.php:437-525.
- **Port notes:** `POST /appointments/:id/reschedule` re-runs the slot engine for the target (excluding the booking itself), recomputes the seat, keeps the status, re-arms every reminder offset, emits `appointment.rescheduled`, sends the reschedule message through the message port (D-04, D-05).

### TW-APPT-005 — Booking types list: cards, pause, delete, counts

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-APPT-001
- **Summary:** `/appointments/booking-types` lists every booking type as a card with Active/Paused pill, duration, location type, capacity (when above one), fee (when above zero) and the number of appointments ever booked; buttons: pause/activate, edit, delete. A JSON list feeds the flow builder's "Service" dropdown.
- **Actors & access:** admin role + plan flag.
- **UX & screens:** `user/appointments/booking-types/index.blade.php`. Header: "Booking types", links All bookings, Settings, New booking type. Card colour square uses the type colour (default `#075E54`). Delete asks "Delete this booking type? Existing bookings stay." Empty state "No booking types yet" with a create button.
- **Endpoints:**

| METHOD uri                                  | route name                              | Controller@action             | request | response                              |
| ------------------------------------------- | --------------------------------------- | ----------------------------- | ------- | ------------------------------------- |
| GET appointments/booking-types              | user.appointments.booking-types.index   | BookingTypeController@index   | none    | Blade                                 |
| GET appointments/booking-types/list         | user.appointments.booking-types.list    | BookingTypeController@apiList | none    | `{types:[{id,name,duration,active}]}` |
| POST appointments/booking-types/{id}/toggle | user.appointments.booking-types.toggle  | BookingTypeController@toggle  | none    | redirect "Updated."                   |
| DELETE appointments/booking-types/{id}      | user.appointments.booking-types.destroy | BookingTypeController@destroy | none    | redirect "Booking type removed."      |

- **Data:** ordered by `sort_order` then id descending (newest first); `appointments_count` counts every status. Delete is a **soft delete**: the type disappears and its appointments keep the foreign key (the manage page still resolves it).
- **Rules & edge cases:**
  1. No `sort_order` UI: all types are 0, so the list is newest first.
  2. Deleting a type does not cancel its future bookings, does not cancel their reminders, and the type's slug stays reserved by the soft-deleted row.
  3. Toggle flips `is_active`; a paused type is not offered by the flow node.
  4. The picker list includes inactive types (flagged `active`).
- **Acceptance criteria:**
  - Given a type with 3 bookings, Then the card says "3 booked".
  - Given a paused type, Then the flow node does not offer it.
  - Given a delete, Then its past bookings remain visible on `/appointments`.
- **Source refs:** BookingTypeController.php:32-109, resources/views/user/appointments/booking-types/index.blade.php.
- **Port notes:** `GET/POST/PATCH/DELETE /booking-types`, `GET /booking-types/options` (the picker), activation through `PATCH {isActive}`. Delete is hard; appointments keep their snapshot (title, times, zone, location) and lose only the type link; booking types with future active bookings refuse deletion with `409 BOOKING_TYPE_HAS_UPCOMING` (D-10).

### TW-APPT-006 — Booking type wizard: create, edit (save everything at once)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-APPT-005
- **Summary:** one form in five steps (the docs and class comment say three): Service, Timing, Availability, Pricing, Messaging, plus a persistent right rail with a live total, a WhatsApp-style card preview and a slot preview. One POST (create) or PUT (edit) writes the type and every child in a single transaction.
- **Actors & access:** admin role + plan flag.
- **UX & screens:** `_form.blade.php`, `create.blade.php`, `edit.blade.php`, `resources/js/charts/user-booking-type-wizard.js`. Stepper with clickable nodes, Back / Next / Cancel / Create booking type (or Save changes). Validation errors listed at the top. Currency list = the admin's active currencies (the current value is kept even if inactive).
- **Endpoints:**

| METHOD uri                               | route name                             | Controller@action            | request          | response                                 |
| ---------------------------------------- | -------------------------------------- | ---------------------------- | ---------------- | ---------------------------------------- |
| GET appointments/booking-types/create    | user.appointments.booking-types.create | BookingTypeController@create | none             | Blade                                    |
| POST appointments/booking-types          | user.appointments.booking-types.store  | BookingTypeController@store  | all fields below | redirect "Booking type ":name" created." |
| GET appointments/booking-types/{id}/edit | user.appointments.booking-types.edit   | BookingTypeController@edit   | none             | Blade                                    |
| PUT appointments/booking-types/{id}      | user.appointments.booking-types.update | BookingTypeController@update | all fields below | redirect "Booking type ":name" updated." |

- **Data (validation):** `name` required, max 191; `slug` optional max 191; `description` text; `location_type` in address|virtual|phone; `location_value` text; `color` max 9; `duration_minutes` required int 5-1440; `increment_minutes` int 5-1440 (default = duration); `buffer_before_minutes` / `buffer_after_minutes` int 0-1440; `min_notice_minutes` int >= 0 (form default 240; server default 0 when blank); `max_advance_days` int 1-365 (default 30); `max_per_day` int 1-500; `capacity` int 1-500 (default 1); `timezone` max 64 (form default: the workspace zone); `is_active` bool (default true); plus the money, calendar and children fields (features 010-015).
- **Rules & edge cases:**
  1. The slug is `Str::slug(slug or name)` (or `type-xxxxxx` when empty) made unique per workspace by appending `-2`, `-3`; it is regenerated from the posted slug on every save.
  2. **Children are replace-all** on every save: availability rules, overrides, templates, reminders and questions are deleted and recreated with new ids. The form has no inputs for overrides, so **every edit deletes every date override** (QUIRK, TW-APPT-010).
  3. A blank `increment_minutes` becomes the duration. The timezone is not validated at save (`safe_timezone` maps unknown to UTC and fixes aliases like Asia/Calcutta at read time).
  4. Reminder offsets must be distinct (422 "Reminder times must be distinct.").
  5. Free text is not trimmed beyond the input middleware; there is no unique-name rule.
  6. The `user_id` is the creating admin and is never updated.
  7. The create page and the edit page show the same wizard; the live total and slot preview run client side from the form state.
- **Acceptance criteria:**
  - Given a name and duration 30, When saved, Then the type exists, active, capacity 1, 30-minute step, with a slug.
  - Given two reminders of the same offset, Then 422.
  - Given an edit, Then the children equal what was posted.
- **Source refs:** BookingTypeController.php:63-341, `_form.blade.php`, user-booking-type-wizard.js.
- **Port notes:** `PATCH` takes `rowVersion` and treats absent children as "keep" (D-06); validation moves to `@crm/contracts`; money fields are decimal strings (D-11).

### TW-APPT-007 — Service details: name, slug, description, location, colour

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-APPT-006
- **Summary:** step 1: Name, Description, Location type (In person (address), Virtual (video), Phone call) and Location / address text.
- **Rules & edge cases:**
  1. `location_type` default `address`; `location_value` is free text (an address, a video URL or a phone number); it is copied to the appointment's `location` at booking and shown on the manage page only for type `address` or when a Meet URL exists.
  2. `virtual` implies `create_meet = true` when the Calendar step leaves it unset.
  3. There is no WhatsApp location type and no per-type host; `color` has no input in the wizard (it is a column that only the list renders).
  4. The preview card shows the name, duration and location label.
- **Acceptance criteria:**
  - Given a virtual type, When booked and Google is connected, Then a Meet link is created.
  - Given an address type with a value, Then the manage page shows the address.
- **Source refs:** `_form.blade.php` step 1, BookingTypeController.php:160-239.
- **Port notes:** add the `whatsapp` location type, the `color` input, and a `hostId` (D-12).

### TW-APPT-008 — Timing and capacity rules

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-006
- **Summary:** step 2: Duration, Start step, Capacity (per slot), Buffer before, Buffer after, Min notice, Book up to (days), Max per day, Timezone.
- **Rules & edge cases:**
  1. Ranges are in TW-APPT-006. Defaults in the form: duration 30, step 30, capacity 1, buffers 0, min notice **240**, advance 30.
  2. `max_per_day` blank means unlimited (100 is used inside the engine).
  3. `capacity` above one makes the type a group event: several customers share a slot (TW-APPT-018).
  4. The type zone defaults to the workspace zone, then the app zone, then UTC.
- **Acceptance criteria:**
  - Given step 60 and duration 30, Then start times are 60 minutes apart.
  - Given capacity 5, Then a slot stays open until five seats are taken.
- **Source refs:** `_form.blade.php` step 2, BookingType.php:effectiveTimezone.
- **Port notes:** the same fields and ranges; timezone validated as an IANA zone; `approvalRequired` added (EXT-APPT-03).

### TW-APPT-009 — Weekly availability intervals

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-006
- **Summary:** step 3: for each weekday (Monday first in the form, stored 0 = Sunday ... 6 = Saturday) any number of "from - to" intervals.
- **Rules & edge cases:**
  1. Stored as `booking_availability_rules` (weekday, start_time, end_time) in the type's zone. `staff_id` exists and is never used.
  2. An interval needs both times; `HH:MM` is taken from the first five characters. **No check that `to` is after `from`, no overlap check**: a reversed interval yields no slots; overlapping intervals yield duplicate slots at the same start.
  3. A day with no interval is closed. A new type has no intervals: it offers no slots until hours are added (the wizard does not pre-fill the Mon-Fri 9-18 of the legacy settings).
  4. The slot preview on the right refreshes when this step opens.
- **Acceptance criteria:**
  - Given Monday 09:00-12:00, duration 60, step 60, Then Monday offers 09, 10, 11.
  - Given no intervals, Then the preview says "No bookable times".
- **Source refs:** `_form.blade.php` step 3, BookingTypeController.php:266-278, SlotEngine.php:84-96.
- **Port notes:** reject `to <= from` and overlapping intervals (422); keep weekday 0-6 with 0 = Sunday.

### TW-APPT-010 — Date overrides: closed days and special hours

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-009
- **Summary:** `booking_availability_overrides` hold a date, `is_closed`, optional start/end time and a reason, unique per type and date.
- **Rules & edge cases:**
  1. The wizard has no inputs for them; only a hand-written POST (`overrides[]`) can create them, and the next edit through the wizard deletes them all (TW-APPT-006 rule 2).
  2. The engine honours only `is_closed`: **special hours (start_time, end_time on an open override) are stored and ignored.**
  3. The closed list is compared against the slot's date in the type zone.
- **Acceptance criteria:**
  - Given a closed override on a Monday, Then no Monday slot of that date is offered.
- **Source refs:** BookingAvailabilityOverride.php, SlotEngine.php:126-148.
- **Port notes:** honour special hours (they replace the weekly intervals of that date), add the editor, never wipe overrides on edit, endpoints to add and remove one date (D-03, D-06).

### TW-APPT-011 — Pricing, tax and deposit

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-006
- **Summary:** step 4: Currency, Fee, Tax %, Deposit (No prepayment / Partial deposit / Full amount), Deposit amount, Payment gateway; plus recorded-only cancel fee, no-show fee and cancel window.
- **Data (validation):** `fee_minor` int >= 0 (the form asks for **minor units**: "15000 = 150.00"), `tax_pct` numeric 0-100, `currency` 3 letters (defaults to the workspace currency), `gateway_slug` max 64, `deposit_mode` none|partial|full, `deposit_value_minor` int >= 0, `auto_send_link` bool default true, `cancel_fee_minor`, `no_show_fee_minor` int >= 0, `cancel_window_minutes` int >= 0 default 1440. One row per type (`booking_financials`, upserted).
- **Rules & edge cases:**
  1. `total = round(fee x (1 + tax/100))`; `due now` = total when mode is full, the deposit amount when partial, else 0.
  2. A partial deposit can exceed the total; nothing checks it.
  3. A currency is "zero decimal" only for a hard-coded list (JPY, KRW, VND, CLP, PYG, UGX, RWF, XOF, XAF, IDR) in the pay-link code; three-decimal currencies are wrong.
  4. The live total in the right rail is client side.
  5. `no_show_fee_minor` is never read. `auto_send_link` is never read. The note says "Cancel / no-show fees are recorded only".
  6. When due-now is above zero but the type has **no gateway**, the flow node books for free (TW-APPT-027).
- **Acceptance criteria:**
  - Given fee 10000, tax 10, mode full, Then due now is 11000.
  - Given mode partial and deposit 2500, Then due now is 2500.
- **Source refs:** BookingFinancial.php, BookingTypeController.php:241-254, `_form.blade.php` step 4.
- **Port notes:** amounts are decimal strings in major units with the currency's own exponent (`@crm/contracts` money), a partial deposit above the total is 422, `no_show_fee` is recorded when a booking is marked no-show (D-11, D-13).

### TW-APPT-012 — Calendar targeting: calendar id, Meet, Sheets

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-APPT-006
- **Summary:** per type: `calendar_id` (picker when Google is connected, else a text box; blank = primary), a "Create a Google Meet link" checkbox, a Sheets spreadsheet id and range (`Sheet1!A1`). One row per type (`booking_integrations`).
- **Rules & edge cases:** `create_meet` defaults to true for a virtual type. The sheet range's tab part is used. No tokens are stored here (they live in the workspace's encrypted settings).
- **Source refs:** BookingIntegration.php, BookingTypeController.php:256-263.
- **Port notes:** persisted unchanged; the write path is the calendar port (D-08).

### TW-APPT-013 — Lifecycle message templates (four events)

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-006
- **Summary:** step 5 lists Confirmation, Reminder, Cancellation, Reschedule; each has a WhatsApp template picker (excluding Instagram, Facebook and Telegram templates) and a plain-text body used when none is picked.
- **Data:** `booking_templates` (event, channel, wa_template_id, plain_body, variable_map, coupon_code, coupon_id), unique per type, event and channel.
- **Rules & edge cases:**
  1. **Only the Reminder body is ever read** (`{{type}}`, `{{slot}}` replaced). The confirmation, cancellation and reschedule templates are saved and never sent (the confirmation is "wired in P4"); the legacy cancel text comes from the workspace's `cancel_template`. The WhatsApp template ids, variable maps and coupons are never used.
  2. Rows are created for the four events even when empty.
- **Acceptance criteria:**
  - Given a reminder body "See you {{slot}}", When a reminder is registered, Then the text carries the formatted slot.
- **Source refs:** BookingTemplate.php, BookingApiController.php:427-445, `_form.blade.php` step 5.
- **Port notes:** all four events are sent through the message port (D-14); `email` joins the channel list; coupon fields are not exposed.

### TW-APPT-014 — Reminder cadence (offsets)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-006
- **Summary:** up to eight "N minutes before" offsets with an optional label ("24h"), all active.
- **Rules & edge cases:** offsets must be positive and distinct; the eighth is the cap (extra rows are dropped silently); `offset_index` is the position (the handle of the schedule id). A type with no reminder rows sends none (unlike the legacy single reminder that defaults to 60 minutes).
- **Source refs:** BookingReminder.php, BookingTypeController.php:310-322.

### TW-APPT-015 — Questionnaire

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-006
- **Summary:** an intro message and rows of question: label, type (text, textarea, select, number, email, phone, date), "map to" (a contact field name), required flag, and `options` for select.
- **Rules & edge cases:**
  1. Asked one by one in chat in order; select shows numbered options; an optional question can be skipped with "skip". Answers are stored on the appointment as an object **keyed by the question label** (renaming a question orphans old answers).
  2. The wizard row has no input for select `options`.
  3. Nothing validates answers server side (type, required, option membership).
  4. `map_to_contact_field` allows `email`, `name`, `mobile` in code.
- **Source refs:** BookingQuestion.php, BookingApiController.php:204-213, 691-710, flowService.js:2038-2049.
- **Port notes:** answers are validated against the question (D-15) and stored as snapshots (question id, label, type, value).

### TW-APPT-016 — Stateless slot preview from a draft

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-017
- **Summary:** the wizard posts the unsaved draft and gets the slots the engine would offer for a sample window (default 7 days, 1-14), up to 60.
- **Endpoints:**

| METHOD uri                                    | route name                                    | Controller@action                  | request              | response                                    |
| --------------------------------------------- | --------------------------------------------- | ---------------------------------- | -------------------- | ------------------------------------------- |
| POST appointments/booking-types/preview-slots | user.appointments.booking-types.preview-slots | AppointmentController@previewSlots | `draft{...}`, `days` | `{ok, tz, count, slots[{start,end,label}]}` |

- **Rules & edge cases:** the draft's `availability` is `{weekday-or-day: [{from,to}]}`; ignores overrides, reservations and bookings; the time zone falls back to the workspace's; no workspace is 422 `{ok:false, error:'No active workspace.'}`.
- **Source refs:** AppointmentController.php:26-50, SlotEngine.php:61-81.

### TW-APPT-017 — Slot engine: candidate grid, buffers, notice, horizon, time zones

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-APPT-008, TW-APPT-009
- **Summary:** one algorithm (`GoogleCalendarService::computeFreeSlots`) shared by the legacy mode and booking types.
- **Rules & edge cases (the algorithm, as written):**
  1. Window: from the start of the range (default now in the type zone) to `from + advance_days` (at least 1 day); a caller's `from`/`to` replace it.
  2. For each calendar day in the zone, take the intervals of that weekday; for each interval, candidates start at the interval start and advance by `increment` (min 5); a candidate fits when `start + duration <= interval end`.
  3. A candidate is skipped when its start is before `now + min_notice` (computed per interval).
  4. **Buffers:** the candidate's clash window is `[start - buffer_before, end + buffer_after)`; it is rejected when any busy interval overlaps it (`busy.start < clashEnd` and `busy.end > clashStart`). So a gap of `buffer_before` is needed AFTER an existing booking and `buffer_after` BEFORE the next one.
  5. Busy intervals are Google free/busy (when a calendar resolves) plus the workspace's own appointments in status pending or confirmed (of the same booking type when one is given), unless the caller asks to skip them (capacity above one).
  6. **Max per day** counts the slots generated that day (the first N free slots), not bookings made.
  7. Generation stops at `limit x 4` candidates, then the result is cut to `limit`.
  8. **Time zones and DST:** wall-clock arithmetic in Carbon (`setTimeFromTimeString`, `addMinutes`, `addDay()->startOfDay()`). A day's interval start/end are wall times resolved by Carbon; around a spring-forward gap a nonexistent wall time shifts forward by Carbon's rule, and the slot loop steps in real minutes from that instant; on a fall-back day the repeated hour resolves to its first occurrence. No test covers DST. `now()` for the notice floor is evaluated in the type zone.
  9. The label is `D j M · g:i A` in the type zone ("Mon 3 Jun · 9:00 AM").
- **Acceptance criteria:**
  - Given buffer_before 15 and a booking 10:00-11:00, Then a 11:00 slot is rejected and 11:15 is allowed.
  - Given min notice 240, Then nothing earlier than now + 4 h is offered.
- **Source refs:** GoogleCalendarService.php:390-538, SlotEngine.php.
- **Port notes:** a pure, tested `slot-engine.ts` with an explicit DST rule (D-01, D-02).

### TW-APPT-018 — Slot engine: overrides, reservations, capacity seats

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-010, TW-APPT-017, TW-APPT-020
- **Summary:** `SlotEngine::freeSlots` wraps the core: it drops closed dates, subtracts live reservations and, for capacity above one, seats of overlapping appointments, and returns `remaining` seats.
- **Rules & edge cases:**
  1. For capacity 1 the core subtracts bookings (with buffers). For capacity N the core skips bookings and the wrapper counts `capacity_used` of overlapping pending or confirmed appointments plus live reservation seats; a slot is dropped at `used + reserved >= capacity`. **Buffers are ignored for capacity above one.**
  2. Reservations count against every capacity, including 1, but only the wrapper applies them (so the core's busy list does not).
  3. Appointments of OTHER booking types never block a type (a two-service business can be double-booked across services); only Google free/busy can.
- **Source refs:** SlotEngine.php:28-52, 119-171.

### TW-APPT-019 — Slots API for the chat flow (days then times, 9 per page)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-017
- **Summary:** the Node runtime asks for the next available **days** (a nine-row page) then, for a chosen day, the **times** (nine per page), plus the active types.
- **Endpoints:**

| METHOD uri            | route name        | Controller@action          | middleware          | request                                        | response                                                                                                                                                                   |
| --------------------- | ----------------- | -------------------------- | ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/booking/types | api.booking.types | BookingApiController@types | api, `X-Node-Token` | workspace_id                                   | `{ok, available, types[{id,name,duration,description,location_type,intro_message,due_now,currency,has_gateway,questions[]}]}` or `{ok,available:false,reason:'feature_off' | 'plan_limit'}` |
| GET api/booking/slots | api.booking.slots | BookingApiController@slots | same                | workspace_id, type_id, offset, day(YYYY-MM-DD) | days mode `{days[{day,label,count}], has_more, next_offset}`; times mode `{times[{start,end,label}], ...}`                                                                 |

- **Rules & edge cases:**
  1. The caller is trusted by a shared secret header (`hash_equals` with the node token); a wrong token is 401. The workspace id comes from the caller.
  2. Day mode generates up to 500 slots across `max_advance_days` from the start of today and groups by date; times mode generates up to 200 for the day. Page size 9, `offset` in rows, `has_more` when more remain.
  3. An unknown or inactive type is 404 `no_type`.
  4. `types` also applies the offer gate: feature off, or the monthly cap reached (pending and confirmed appointments with `starts_at >= start of month` against `appointments_limit`).
- **Source refs:** BookingApiController.php:39-137, 671-689.
- **Port notes:** service methods for the flow engine (no shared-secret HTTP): `BookingOffersService` (types, days, times) and the same slots over the public API (EXT-APPT-01).

### TW-APPT-020 — Reserve a slot (ten-minute soft lock)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-018
- **Summary:** while the customer answers the questions or pays, the node takes a one-seat `slot_reservations` row expiring in ten minutes.
- **Endpoints:** `POST api/booking/reserve` (`BookingApiController@reserve`, node token): `starts_at` required, `session_ref` max 191, `channel` max 32 (default whatsapp); success `{ok, reservation_id, expires_at}`, full `{ok:false, error:'slot_taken'}`.
- **Rules & edge cases:** the soft check counts live reservations and booked seats against capacity; the end is `start + duration`; **the requested start is not validated against the engine's slots** (any instant can be reserved); a customer can hold many reservations; they are deleted when the booking commits and swept when expired.
- **Source refs:** BookingApiController.php:139-180, SlotReservation.php.

### TW-APPT-021 — Book a booking-type slot (hard guard, seats, replay)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-APPT-018, TW-APPT-019
- **Summary:** `POST /api/booking/book` commits a **confirmed** appointment and returns its id and manage token. The double-booking guard is a unique key `active_slot_key = typeId:epoch:seat` (null when not active).
- **Endpoints:** `POST api/booking/book` (`BookingApiController@book`, node token): `workspace_id`, `type_id`, `starts_at` (date, required), `contact_id`, `conversation_id`, `customer_name` (191), `customer_phone` (32), `customer_email`, `answers` (array), `reservation_id`. Response `{ok, appointment_id, status, manage_token}`, or `{ok, appointment_id, duplicate:true}`, or `{ok:false, error:'slot_taken'|'plan_limit'|'commit_failed'}`.
- **Rules & edge cases:**
  1. The offer gate is checked again (feature, monthly cap).
  2. The start is normalised to UTC; `end = start + duration`; **the start is not checked against availability, notice, horizon or the engine at all**: any instant books if its key is free.
  3. Replay: the same conversation booking the same type and instant while pending or confirmed returns the existing booking (`duplicate`). With no conversation id there is no replay.
  4. Capacity 1: seat 1, so only an **identical start** collides (two bookings 10:00-11:00 and 10:30-11:30 of the same type are both accepted: overlapping starts are not detected). Capacity N: under a 10-second cache lock keyed `book:type:epoch`, the lowest free seat ordinal is found among identical-start bookings; all seats taken = `slot_taken`.
  5. Title `"{type name} — {customer name or 'Booking'}"`; description, location and `timezone` come from the type; `status` confirmed, `source` chat, `capacity_used` 1; meta holds name, phone, email; `answers` stored; a manage token is generated (48 random characters, unique).
  6. After the response (terminating callback): the Google event / Meet link, the Sheets row and one reminder per active offset are written; failures are logged only. `afterConfirm` runs only when the calendar is enabled platform-wide and resolvable.
  7. **There is no approval step and no pending state** for booking types.
  8. A booking made inside a reminder's window skips that reminder (the offset time is in the past).
- **Acceptance criteria:**
  - Given a free slot, When booked, Then `ok` with an appointment id and a manage token.
  - Given the same slot booked twice for a capacity-1 type, Then the second answer is `slot_taken`.
  - Given a capacity-2 type, Then the third booking of the slot is `slot_taken`.
- **Source refs:** BookingApiController.php:182-451, Appointment.php:94-110.
- **Port notes:** one booking service for staff, public and flow callers; validated against the engine; an exclusion constraint on (type, seat, time range) plus a per-type advisory lock (EXT-APPT-05, D-05).

### TW-APPT-022 — Single-calendar mode: workspace settings screen

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-001
- **Summary:** `/appointments/settings`: Step 0 connect Google (when the platform enabled it and set a client id), Step 1 which calendar, Step 2 one availability window per weekday, Step 3 booking rules. Stored in the workspace's encrypted `appointment_settings` JSON.
- **Endpoints:**

| METHOD uri                 | route name                      | Controller@action                  | request                                                                                                                                                                                                                | response                               |
| -------------------------- | ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| GET appointments/settings  | user.appointments.settings      | AppointmentController@settings     | none                                                                                                                                                                                                                   | Blade                                  |
| POST appointments/settings | user.appointments.settings.save | AppointmentController@saveSettings | calendar_id, calendar_name, calendar_timezone, slot_duration_minutes 5-480, buffer_before/after 0-240, max_per_day 1-96, advance_days 1-90, reminder_minutes_before 0-1440, default_location 191, availability_windows | redirect "Appointment settings saved." |

- **Rules & edge cases:** windows accept 12-hour or 24-hour times and keep only rows where `from < to`; the default for a fresh workspace is Mon-Fri 09:00-18:00; only one interval per weekday in the UI. Defaults: duration 30, buffers 0, max per day 16, advance 14, reminder 60. `cancel_template` and `reminder_template` are read by code and have no input. The settings page needs no plan flag.
- **Source refs:** AppointmentController.php:84-148, 527-582, settings.blade.php.
- **Port notes:** replaced by booking types (D-16): the screen's windows and rules ARE a booking type's fields.

### TW-APPT-023 — Single-calendar mode: slots and book API for the flow node

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-022
- **Summary:** `GET /api/appointments/slots` (node token or a signed-in user) and `POST /api/appointments/book` (node token) serve workspaces with no booking types.
- **Rules & edge cases:** slots: `limit` 1-10 (default 5), 503 `integration_disabled` when a calendar is linked but the platform toggle is off; book: validates `workspace_id`, `starts_at`, `ends_at`, title (191), description (2000), contact, conversation, customer name, phone (32), email; monthly cap through the plan guard; replay on (start, conversation) while pending or confirmed; creates a `pending` appointment with **no type and no active_slot_key** (so nothing prevents a double booking), writes the Google event (status becomes `confirmed` only when the event was written; otherwise stays `pending`), and registers the single reminder after the response.
- **Acceptance criteria:**
  - Given a calendar failure, Then the appointment stays pending and `calendar_synced:false` is returned.
- **Source refs:** AppointmentController.php:150-385.

### TW-APPT-024 — Public manage page (capability token)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-APPT-021
- **Summary:** `GET /b/manage/{token}` shows the booking (type name, status pill, date, time and zone, Meet link or address) with Reschedule and Cancel buttons while it is active.
- **Endpoints:** `GET b/manage/{token}` (`BookingManageController@show`, `web`, throttle 60/min). Unknown token 404.
- **Rules & edge cases:** the pill shows Cancelled for cancelled or no-show, Completed for completed, else "Confirmed" (even for a pending or declined appointment); GET never mutates (a chat preview prefetch cannot cancel anything); the page is laid out for a guest.
- **Source refs:** BookingManageController.php:28-42, show.blade.php.

### TW-APPT-025 — Public reschedule

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-024, TW-APPT-019
- **Summary:** a day then time picker (JSON from `/b/manage/{token}/slots`) and a POST that moves the booking.
- **Endpoints:** `GET b/manage/{token}/reschedule` (410 for cancelled, completed, no-show), `GET b/manage/{token}/slots` (`day` optional; days mode lists the days, times mode the times), `POST b/manage/{token}/reschedule` (`starts_at`).
- **Rules & edge cases:** **the posted start is not validated against the engine** (any instant not colliding on the unique key is accepted: a customer can book outside hours or in the past by crafting the POST); the end is `start + duration`; the slot key is recomputed (with seat 1: for a capacity-N type a rescheduled booking ends on seat 1); a collision answers "That time was just taken - please pick another." The Google event is deleted and recreated, then every reminder offset re-registers with the same ids (so they replace). The 60/min throttle is the only abuse control. A booking whose type was deleted is 410.
- **Source refs:** BookingManageController.php:44-114, 156-203, reschedule.blade.php.
- **Port notes:** the target is validated by the engine (D-05); the customer's own booking is excluded from conflicts; status guard pending|confirmed and not started.

### TW-APPT-026 — Public cancel and the recorded cancel fee

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-024
- **Summary:** `POST /b/manage/{token}/cancel` cancels (410 if already cancelled, completed or no-show), clears the slot key, records `meta.cancel_fee_recorded_minor` when the start is within the cancel window and the type has a cancel fee, sets `meta.cancelled_via = manage_link`, and deletes the calendar event.
- **Rules & edge cases:** the fee is only recorded (no charge, no refund); `diffInMinutes` is absolute, so a **past** appointment also counts as inside the window; **no cancellation message and no reminder teardown** on this path (the reminders already registered still fire); no cancel reason.
- **Source refs:** BookingManageController.php:116-154.
- **Port notes:** teardown is automatic (a cancelled booking is no longer reminded), `appointment.cancelled` event, cancel message (D-04, D-13).

### TW-APPT-027 — Booking payment: pay link and gateway callback

- **Status:** dead-code (the pay link route does not exist)
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-APPT-011, TW-APPT-021
- **Summary:** for a type with a deposit and a gateway the node posts `/api/booking/pay-link`: an `Order` (number `BK-xxxxxxxxxx`) carries the booking context, the gateway driver is initiated, the customer pays on the gateway and is redirected to `GET|POST /b/pay/callback/{gateway}` which verifies, marks the order paid and commits the booking (confirmed, `payment_status = paid`, `deposit_paid_minor` = amount due, `order_id`).
- **Endpoints:** `GET|POST b/pay/callback/{gateway}` (`BookingPaymentController@callback`, web, **no throttle**): `?bo=` order id, else the gateway's echoed order id; unknown gateway or order, verify failure, failed, pending (another redirect or "processing") each render the payment-result page; a paid callback redirects to the manage page with a success flash.
- **Rules & edge cases:**
  1. **`BookingApiController::payLink` has no route** (routes/api.php lists types, slots, reserve and book only), so the node's pay-link POST is a 404 and the customer is told "we couldn't set up payment". The callback and the confirmation code are reachable but nothing starts a payment.
  2. Confirmation is idempotent per order (an existing pending or confirmed appointment for the order is returned).
  3. If the slot was taken meanwhile (key collision) the driver's `refund` is tried; the order becomes `refunded` or `paid` with `refund_required = true`; the customer is told which.
  4. Amount: `due / 100`, or whole units for a hard-coded zero-decimal list.
  5. When due-now is above zero but the type has no gateway, `bkFinalize` skips payment and books free.
  6. Cancel fee and no-show fee are never charged.
- **Source refs:** BookingApiController.php:457-669, BookingPaymentController.php, flowService.js:2090-2125.
- **Port notes:** no gateway is built here. A paid type creates a **pending** booking with `payment_status = pending`, holds the slot for 30 minutes, emits `appointment.payment_due` for the payments domain, and `POST /appointments/:id/payments` (or `AppointmentsService.recordPayment`) settles it; unpaid holds expire (D-13).

### TW-APPT-028 — Google Calendar OAuth: connect, disconnect, calendar list

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-001
- **Summary:** `POST /appointments/oauth/google/start` redirects to Google with a random state; `GET /appointments/oauth/google/callback` exchanges the code and stores the tokens; `POST .../disconnect` revokes at Google then clears the workspace's tokens.
- **Rules & edge cases:** state is held in the session and compared; the return target must start with `/` (open-redirect guard); scopes default to a bundle covering Calendar, Sheets, Docs, Drive, Forms and userinfo (overridable by a system setting); `access_type=offline` and `prompt=consent` so a refresh token is always returned; tokens are stored in the workspace's `appointment_settings.google_oauth` (encrypted JSON); refresh runs 60 seconds before expiry under a cache lock; the client id and secret and the master toggle `google_calendar_enabled` (default off) are admin settings; the callback route has no role middleware (only auth).
- **Source refs:** GoogleCalendarOAuthController.php, GoogleCalendarService.php:30-215, AdminPagesController.php:3200-3215.
- **Port notes:** built in this domain behind the calendar port (EXT-APPT-08, D-08): `POST /appointments/calendar/google/start`, the public `GET /public/appointments/calendar/google/callback`, `GET /appointments/calendar/google/calendars`, `PUT .../calendar`, `POST .../disconnect`; the platform operator's Google client is the console group `googleCalendar` (env fallback); the grant is the sealed row of `appointment_calendar_connections`; a refused grant is `needs_reconnect`. Differences from Reference (narrower scopes, signed state, no plan gate `integration_google_calendar`, the other Google consumers not ported) are item 19 of `parity/product-extensions.md`. Not run against real Google. Docs: `docs/api/appointments-booking.md` (Google Calendar), `docs/runbooks/google-calendar-setup.md`.

### TW-APPT-029 — Calendar event write: create, Meet link, move, delete, Sheets append

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-APPT-012, TW-APPT-028
- **Summary:** after a booking commits: create a Calendar event (summary = type name, description, location, start and end with the type zone, default reminders, the customer as attendee with Google's invite when an email exists), or an event with a Meet link for a virtual type or when `create_meet` is set; store `google_event_id`, `google_calendar_id`, `meet_url`; append a Sheets row (date, time, name, phone, type, status, Meet URL). Reschedule by the customer deletes and recreates; cancel deletes.
- **Rules & edge cases:** all failures are logged and swallowed (the booking stands); `afterConfirm` needs the platform toggle on; the Meet URL is read from `conferenceData.entryPoints[0].uri`; the single-calendar mode creates the event synchronously and marks the booking `confirmed` only if it was written.
- **Source refs:** BookingApiController.php:359-420, GoogleCalendarService.php:262-388.
- **Port notes:** a `CalendarSyncPort` with event-driven hooks (`appointment.booked|confirmed|rescheduled|cancelled|declined`); no direct Google call from the domain (EXT-APPT-08). `GoogleCalendarAdapter` is the real adapter: create or update by a deterministic event id (idempotent), Meet link, move, delete, free/busy for the slot engine. The Sheets append stays `blocked` (its scope is not requested).

### TW-APPT-030 — Reminder scheduling on the Node bridge

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-APPT-014, TW-APPT-021
- **Summary:** each reminder is a one-off scheduled WhatsApp text on the Node bridge (`POST /api/schedule-message-bulk/{devicePhone}`), keyed by a synthetic id so a re-registration replaces it: `-2_000_000_000 - id*100 - offset_index` for booking types, `-1_000_000 - id` for the legacy single reminder.
- **Rules & edge cases:** only when the customer phone is known; skipped when no bridge URL, no connected sender for the workspace's engine (a paired device, or the connected WABA / Twilio config) or the offset time is already past; the body is the reminder template (`{{type}}`, `{{slot}}`) or the workspace's default text (`{title}`, `{time}`, `{date}`); the sender is the device of the booking's conversation, else the workspace's first active device; the schedule is registered once at booking, so editing a type's offsets later does not touch existing bookings; **no worker re-checks the schedule** (it is a remote row).
- **Source refs:** AppointmentReminderScheduler.php, BookingApiController.php:422-448.
- **Port notes:** a sweep claims due reminders idempotently and emits `appointment.reminder_due`; the message port sends (EXT-APPT-08, D-14).

### TW-APPT-031 — Cancellation notification and reminder teardown

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-003, TW-APPT-030
- **Summary:** the staff cancel unschedules every reminder id on the Node bridge (best effort, one DELETE per id) and schedules a cancellation text three seconds out using the workspace's `cancel_template` ("Your appointment "{title}" on {time} has been cancelled. Contact us to rebook.").
- **Rules & edge cases:** the public cancel does neither; booking-type `cancellation` templates are not used; no message when the phone is unknown.
- **Source refs:** AppointmentController.php:401-432, AppointmentReminderScheduler.php:132-152.

### TW-APPT-032 — Lifecycle sweeper: reservations, needs-review, auto-complete

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-APPT-020
- **Summary:** run on the Node 30-second heartbeat under a 25-second cache lock: (1) delete up to 200 expired reservations; (2) flag up to 100 confirmed appointments that ended more than 15 minutes ago and were never checked in with `meta.needs_review = true`; (3) set up to 100 confirmed, ended, checked-in appointments to `completed`.
- **Rules & edge cases:** **nothing ever sets `checked_in_at`** (no route, no UI), so step 3 never matches and appointments never complete; nothing displays `needs_review`; no_show is never set by any code. The sweep runs only while a Node device heartbeats.
- **Source refs:** AppointmentLifecycleSweeper.php, WaConnectController.php:773-780.
- **Port notes:** a worker job; staff actions complete, no-show and check-in make the statuses reachable (EXT-APPT-04, D-04).

### TW-APPT-033 — Questionnaire answers mapped onto the contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-015, TW-APPT-021
- **Summary:** after a booking, for each question with `map_to_contact_field` in email, name, mobile and an answer under its label, the matching contact field is set **only when it is empty**; the contact is saved.
- **Rules & edge cases:** only for a contact the node passed in; failures are swallowed; no format check on the value; the chat flow's own `__email` answer is separate.
- **Source refs:** BookingApiController.php:691-710.

### TW-APPT-034 — The "Book appointment" flow node

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-APPT-019, TW-APPT-021, TW-APPT-023
- **Summary:** a flow node type `book_appointment` (runtime `BookAppointment`) with settings `slotCount` (default 5), `prompt`, `confirmation` (default "Booked! See you on {{slot}}."), `calendarOverride`, `collectEmail`, `bookingTypeId` (0 = customer chooses) and two ports: `booked` and `no_slots`.
- **Rules & edge cases:** when the workspace has booking types the node runs the multi-service state machine (CHOOSE_TYPE if several, CHOOSE_DAY, CHOOSE_SLOT, ASK_QUESTIONS, reserve, book or pay link, confirmation); with no types it falls back to the single-calendar list message. A single (or pinned) type skips the menu. Lists are capped at 10 rows (9 plus "more"). The confirmation replaces `{{slot}}`, `{{type}}`, `{{manage_link}}` and appends "Reschedule or cancel: {link}" when the text has no `{{manage_link}}`. On success the variables `slot` and `appointment_id` are set. `slot_taken` re-shows the slot list; any other failure leaves through `no_slots`.
- **Source refs:** FlowNormalizer.php:77,104,768-778, flowService.js:908-1180, 1930-2470, FlowsController.php:693,975-985.
- **Port notes:** the flow-runtime domain calls `BookingOffersService` and `AppointmentsService.book` (documented in `docs/api/appointments-booking.md`); not built here.

### TW-APPT-035 — Plan monthly cap (`appointments_limit`)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-APPT-001
- **Summary:** a package column `appointments_limit` (nullable; empty or 0 = unlimited).
- **Rules & edge cases:** the legacy `POST /api/appointments/book` counts **every** appointment with `starts_at >= start of this month` (any status, **including future months**) through `PlanLimitGuard::check`; the booking-type offer gate counts pending and confirmed only, against the same lower bound, and answers `{available:false, reason:'plan_limit'}` at offer time and `plan_limit` at book time. A cancelled booking still counts in the legacy path.
- **Source refs:** AppointmentController.php:254-257, BookingApiController.php:671-689, Package.php:97,207.
- **Port notes:** the cap is a plan limit `appointments`, counted over active (pending, confirmed, completed) bookings **starting in the same calendar month as the new one** in the workspace zone (D-17).

### TW-APPT-036 — Navigation, dashboard, quick access, workspace wipe, conversation merge

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-APPT-001
- **Summary:** consumers of the table and the flag: the user nav ("Appointments", admin tier, `access_appointment_booking`), the "More" page and dashboard tile ("Bookings & calendar"), quick access ("Bookings and calendar scheduling"), the expired-workspace wipe (deletes `appointments` rows), the duplicate-conversation merger (repoints `appointments.conversation_id`), and the admin console's Google-connected workspace count.
- **Source refs:** UserNav.php:182, QuickAccess.php:36, dashboard/index.blade.php:399, WipeExpiredWorkspaces.php:32, DuplicateConversationMerger.php:62, AdminPagesController.php:3200-3215.
- **Port notes:** tenant deletion cascades through `org_id`; the conversation FK is `ON DELETE SET NULL` (a merge repoints it through the chat domain); nav is the web port's.

### TW-APPT-037 — Engine (provider) stamp and scope

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** `appointments.provider` (baileys, waba, twilio) is stamped from the workspace's active engine on create; the staff list is filtered by the workspace's enabled engine set (`forCurrentEngine`); the reminder picks its sender by engine.
- **Rules & edge cases:** bookings made under an engine the workspace later disabled vanish from the list. Booking types have no provider.
- **Port notes:** channels are connections in this stack; the column stays as the channel hint and the list is not filtered by it (D-18).

### TW-APPT-038 — Manage token: unguessable capability

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-APPT-021
- **Summary:** the token is 48 random characters (not an HMAC of the id), unique, generated at booking; possession authorises managing that one booking; GET only renders so a link preview cannot change anything; mutations are POST. No expiry, no rotation, never shown to staff, stored in clear in `appointments.manage_token`.
- **Source refs:** Appointment.php:ensureManageToken, BookingManageController.php:17-34.
- **Port notes:** 256-bit token, only its SHA-256 is stored (an encrypted copy lets staff copy the link and rotate it), constant-time lookup by hash, throttled per IP and per link (D-19).

### TW-APPT-039 — Status model

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** declared statuses: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`. Code also tests for `declined`, which nothing sets.
- **Rules & edge cases:**
  1. `pending`: single-calendar booking before the calendar write, or no calendar. `confirmed`: booking-type bookings from creation, or after a calendar write.
  2. `cancelled`: staff or customer. `completed`: only the sweeper's check-in path. `no_show`: nothing sets it.
  3. No status column constraint, no transition guard, no timestamps, no audit trail (the comment says "a human then decides completed vs no_show": no UI exists).
  4. `payment_status` (none, pending, paid, partial, refunded): only `paid` is ever set. `source` (chat, link, manual, api): only `chat` is set.
  5. Appointments are soft-deleted (no route deletes).
- **Port notes:** a guarded machine (see "Port decisions" T-table) and constraints; `declined` becomes real with approval (EXT-APPT-03, EXT-APPT-04).

### TW-APPT-040 — `appointment_booked` flow trigger and notification toggle

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-APPT-021
- **Summary:** the flow model lists the event trigger kind `appointment_booked` and the workspace notification types list "Appointment booked" (a toggle), but **no code fires either** after a booking.
- **Source refs:** Flow.php:373, Workspace.php:194.
- **Port notes:** `appointment.booked` is emitted in the outbox; the flow-trigger and notification consumers belong to their domains (D-20).

## Data model

All ten tables are tenant tables in Reference (`workspace_id`), 0 rows in the local reference. Our drafted migration `20261001104800_appt_threadwise_schema.sql` already holds them with `org_id`, composite keys and forced RLS; `20261012090000_appt_model_reshape.sql` reshapes them (see Port decisions).

- **booking_types**: id, workspace_id, user_id (creator), name, slug (unique per workspace), description, location_type (address|virtual|phone), location_value, color, duration_minutes (default 30), increment_minutes (30), buffer_before/after_minutes (0), min_notice_minutes (240 in the form), max_advance_days (30), max_per_day (null), capacity (1), timezone, intro_message, is_active, sort_order, meta, soft delete. Read by every feature.
- **booking_availability_rules**: type, staff_id (unused), weekday (0 = Sunday), start_time, end_time. Index (type, weekday).
- **booking_availability_overrides**: type, date, is_closed, start_time, end_time, reason; unique (type, date).
- **booking_questions**: type, label, type (text|textarea|select|number|email|phone|date), options (json), required (true), map_to_contact_field, sort_order.
- **booking_reminders**: type, offset_index, offset_minutes, template_event (reminder), label, is_active; unique (type, offset_index).
- **booking_templates**: type, event (confirmation|cancellation|reminder|reschedule), channel (whatsapp|telegram|instagram|facebook), wa_template_id, plain_body, variable_map, coupon_code, coupon_id; unique (type, event, channel).
- **booking_financials**: type (unique), fee_minor, tax_pct (5,2), currency, gateway_slug, deposit_mode (none|partial|full), deposit_value_minor, auto_send_link, cancel_fee_minor, no_show_fee_minor, cancel_window_minutes (1440).
- **booking_integrations**: type (unique), calendar_id, create_meet, spreadsheet_id, sheet_range (`Sheet1!A1`).
- **slot_reservations**: type, starts_at, ends_at, session_ref, channel, seats, expires_at.
- **appointments**: workspace_id, provider, user_id (host: the workspace owner), contact_id, conversation_id, booking_type_id, staff_id (unused), title, description, location, starts_at, ends_at (nullable), timezone, invitee_timezone (never written), status (string 16), payment_status, deposit_paid_minor, order_id, google_event_id, google_calendar_id, meet_url, manage_token (unique), meta (customer_name, customer_phone, customer_email, cancel_fee_recorded_minor, cancelled_via, needs_review), answers, reminder_sent_at (never written), checked_in_at (never written), reminders_sent (never written), source (chat), capacity_used, active_slot_key (unique), soft delete. Indexes: (workspace, starts_at), (workspace, status), contact, conversation, google_event_id, (type, starts_at), provider.
- Workspace-level (legacy): `workspaces.appointment_settings` (encrypted JSON): `google_oauth{access_token, refresh_token, expires_at, calendar_id, calendar_name, calendar_timezone}`, slot_duration_minutes, buffer_before/after_minutes, max_per_day, advance_days, reminder_minutes_before, default_location, availability_windows, cancel_template, reminder_template.
- Plan: `packages.access_appointment_booking`, `packages.appointments_limit`; admin settings `google_calendar_enabled|client_id|client_secret|scopes|redirect_uri`.

Volumes: bookings are the only growing table (hundreds per workspace per month).

## Cross-domain contracts

- **Consumes** `contacts-attributes-tags`: find-or-create by phone and email (`ContactsService.create`, identity-first), contact link and answer mapping; `plans-subscriptions-trials`: feature `appointment_booking` and limit `appointments` (`PlanEntitlementService`); `workspaces-teams-tenancy`: users (host), time zone from `organizations.settings.timezone`; `message-templates`: WhatsApp template ids per event; `chat-conversations`: `conversation_id`.
- **Exposes** to flows: `BookingOffersService` (types, days, times, reserve) and `AppointmentsService.book` (the node); to contacts: `GET /contacts/:id/appointments`; to notifications, flows, webhooks and payments: outbox events `appointment.booked`, `.confirmed`, `.declined`, `.rescheduled`, `.cancelled`, `.completed`, `.no_show`, `.reminder_due`, `.payment_due`, `.payment_received`, and `booking_type.created|updated|deleted`; to channels: the `AppointmentMessenger` port; to integrations: the `CalendarSyncPort`; to payments: `AppointmentsService.recordPayment`.

## Open questions & quirks

- The docs and class comment say a three-step wizard; the form has five steps.
- Booking-type overrides: stored, special hours ignored, no UI, wiped by every edit (TW-APPT-010).
- Only the reminder template is ever read; the other three lifecycle templates, WhatsApp template ids, variable maps and coupons are dead data (TW-APPT-013).
- `payLink` has no route; the payment callback exists (TW-APPT-027). Due above zero with no gateway books free.
- `reserve` and `book` accept any instant (not validated against the engine); capacity-1 double booking is only detected for **identical** starts; reschedule from the manage link has the same hole and a staff reschedule does not move the guard key.
- A staff cancel keeps the slot key (the slot stays blocked); the public cancel clears it.
- `max_per_day` caps offered slots, not bookings; buffers are ignored for capacity above one; other types never block each other.
- `checked_in_at`, `no_show`, `declined`, `invitee_timezone`, `reminder_sent_at`, `reminders_sent`, `staff_id`, `payment_status` values other than paid, `source` values other than chat: never written.
- Monthly cap counts by `starts_at >= start of month` with no upper bound.
- Answers are keyed by question label.
- Google master toggle defaults off and only applies to workspaces that have a calendar linked.
- The public manage page shows "Confirmed" for a pending appointment.
- The `appointment_booked` trigger and notification toggle are never fired (TW-APPT-040).
- Reminder schedules live in the Node bridge; if a device is offline or unpaired no reminder exists and nothing says so.

## Differences to decide

| Id   | Reference behavior                                                                             | Recommendation for the port                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Wall-clock Carbon arithmetic, DST untested                                                     | A pure engine: each interval's start and end are resolved to instants in the type zone (a gap shifts forward, an overlap takes the first occurrence) and slots step in real minutes between them; unit tests across both DST transitions |
| D-02 | Buffers asymmetric; `max_per_day` caps offered slots; buffers ignored for groups               | Keep the buffer rule (gap `buffer_before` after, `buffer_after` before) and apply it per seat for every capacity; `max_per_day` caps bookings per local day                                                                              |
| D-03 | Overrides: special hours ignored, no UI, wiped by every edit                                   | Honour special hours (replace that date's weekly intervals); overrides replaced only when sent; add/remove one date endpoints                                                                                                            |
| D-04 | No status machine; staff cancel any status; complete and no-show unreachable                   | Guarded machine and staff actions (confirm, decline, cancel, complete, no-show, check-in), audit and an event per transition                                                                                                             |
| D-05 | Booking and rescheduling accept any instant; only identical starts collide                     | Every create and reschedule is validated by the engine (grid, notice, horizon, cap, seat); an exclusion constraint on (type, seat, time range) plus a per-type advisory lock                                                             |
| D-06 | Replace-all children, new ids each save, no version                                            | `PATCH` with `rowVersion`; absent children are kept; sent children are upserted by id so ids stay stable                                                                                                                                 |
| D-07 | 50 upcoming / 20 past, no filters                                                              | Cursor paging, status, date, type, contact, search and `mine` filters, counts endpoint for tabs                                                                                                                                          |
| D-08 | Calendar and Sheets written inline with Google                                                 | A `CalendarSyncPort` with a stub adapter and outbox-driven hooks; the integrations domain supplies a Google adapter                                                                                                                      |
| D-09 | Staff cancel does not free the slot, can re-cancel, no reason                                  | Cancel from pending or confirmed only, frees the slot, optional reason, `cancelledBy`                                                                                                                                                    |
| D-10 | Soft delete of a type, future bookings left orphaned                                           | Hard delete (repo rule); refused with 409 while active future bookings exist; appointments keep their snapshot                                                                                                                           |
| D-11 | Money entered in minor units; hard-coded zero-decimal list; partial deposit above total        | Decimal strings in major units with the ISO exponent; a partial deposit above the total is 422                                                                                                                                           |
| D-12 | No host, no colour input, no WhatsApp location                                                 | `hostId` (default the creator) drives the `own` record scope; colour input; location types address, virtual, phone, whatsapp                                                                                                             |
| D-13 | Payments: pay link unrouted, free booking when no gateway, fees recorded only on public cancel | Paid types create a pending booking with a 30-minute hold and `appointment.payment_due`; payment is recorded through a service call or `POST /appointments/:id/payments`; cancel and no-show fees recorded on those transitions          |
| D-14 | Only the reminder body is sent; reminders live in the Node bridge                              | All four events go through the `AppointmentMessenger` port; reminders are a worker sweep with per-offset idempotent claims; email is a channel                                                                                           |
| D-15 | Answers unvalidated and keyed by label                                                         | Validated against the question (required, type, options); stored as snapshots with the question id                                                                                                                                       |
| D-16 | Single-calendar mode and its settings screen                                                   | Replaced by booking types (the screen's fields are a type's fields). Org-level settings are not stored; a workspace with no types sees an empty state. **Owner to confirm**                                                              |
| D-17 | Monthly cap counts from the start of the month with no upper bound                             | Cap per calendar month of the booking's start (workspace zone), over active bookings                                                                                                                                                     |
| D-18 | Engine-scoped list                                                                             | Not filtered by channel                                                                                                                                                                                                                  |
| D-19 | Manage token stored in clear, never shown to staff, GET throttle 60/min                        | SHA-256 stored, encrypted copy for staff, per-IP and per-link throttles                                                                                                                                                                  |
| D-20 | `appointment_booked` trigger and notification never fired                                      | The outbox event exists; the consumers belong to the flow and notification domains                                                                                                                                                       |
| D-21 | Public manage page shows "Confirmed" for any non-terminal status                               | The page shows the real status; no invitee data is returned                                                                                                                                                                              |

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET appointments",
    "GET appointments/settings",
    "POST appointments/settings",
    "POST appointments/{id}/cancel",
    "POST appointments/{id}/reschedule",
    "POST appointments/booking-types/preview-slots",
    "GET appointments/booking-types/list",
    "GET appointments/booking-types",
    "GET appointments/booking-types/create",
    "POST appointments/booking-types",
    "GET appointments/booking-types/{bookingType}/edit",
    "PUT appointments/booking-types/{bookingType}",
    "DELETE appointments/booking-types/{bookingType}",
    "POST appointments/booking-types/{bookingType}/toggle",
    "POST appointments/oauth/google/start",
    "POST appointments/oauth/google/disconnect",
    "GET appointments/oauth/google/callback",
    "GET api/appointments/slots",
    "POST api/appointments/book",
    "GET api/booking/types",
    "GET api/booking/slots",
    "POST api/booking/reserve",
    "POST api/booking/book",
    "GET b/manage/{token}",
    "GET b/manage/{token}/slots",
    "GET b/manage/{token}/reschedule",
    "POST b/manage/{token}/reschedule",
    "POST b/manage/{token}/cancel",
    "GET b/pay/callback/{gateway}",
    "POST b/pay/callback/{gateway}"
  ],
  "controllers": [
    "app/Http/Controllers/AppointmentController.php",
    "app/Http/Controllers/BookingApiController.php",
    "app/Http/Controllers/BookingManageController.php",
    "app/Http/Controllers/BookingPaymentController.php",
    "app/Http/Controllers/BookingTypeController.php",
    "app/Http/Controllers/GoogleCalendarOAuthController.php"
  ],
  "services": [
    "app/Services/Appointments/AppointmentLifecycleSweeper.php",
    "app/Services/Appointments/AppointmentReminderScheduler.php",
    "app/Services/Appointments/SlotEngine.php",
    "app/Services/GoogleCalendar/GoogleCalendarService.php"
  ],
  "models": [
    "Appointment",
    "BookingAvailabilityOverride",
    "BookingAvailabilityRule",
    "BookingFinancial",
    "BookingIntegration",
    "BookingQuestion",
    "BookingReminder",
    "BookingTemplate",
    "BookingType"
  ],
  "tables": [
    "appointments",
    "booking_availability_overrides",
    "booking_availability_rules",
    "booking_financials",
    "booking_integrations",
    "booking_questions",
    "booking_reminders",
    "booking_templates",
    "booking_types",
    "slot_reservations"
  ],
  "views": [
    "resources/views/public/booking-manage/payment-result.blade.php",
    "resources/views/public/booking-manage/reschedule.blade.php",
    "resources/views/public/booking-manage/show.blade.php",
    "resources/views/user/appointments/booking-types/_form.blade.php",
    "resources/views/user/appointments/booking-types/create.blade.php",
    "resources/views/user/appointments/booking-types/edit.blade.php",
    "resources/views/user/appointments/booking-types/index.blade.php",
    "resources/views/user/appointments/index.blade.php",
    "resources/views/user/appointments/settings.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": ["node/test/booking-smoke.mjs"],
  "js_assets": ["resources/js/charts/user-booking-type-wizard.js"],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/commerce/appointments.html"],
  "feature_map": {
    "TW-APPT-001": ["GET appointments"],
    "TW-APPT-002": ["GET appointments"],
    "TW-APPT-003": ["POST appointments/{id}/cancel"],
    "TW-APPT-004": ["POST appointments/{id}/reschedule"],
    "TW-APPT-005": [
      "GET appointments/booking-types",
      "GET appointments/booking-types/list",
      "POST appointments/booking-types/{bookingType}/toggle",
      "DELETE appointments/booking-types/{bookingType}"
    ],
    "TW-APPT-006": [
      "GET appointments/booking-types/create",
      "POST appointments/booking-types",
      "GET appointments/booking-types/{bookingType}/edit",
      "PUT appointments/booking-types/{bookingType}"
    ],
    "TW-APPT-016": ["POST appointments/booking-types/preview-slots"],
    "TW-APPT-019": ["GET api/booking/types", "GET api/booking/slots"],
    "TW-APPT-020": ["POST api/booking/reserve"],
    "TW-APPT-021": ["POST api/booking/book"],
    "TW-APPT-022": ["GET appointments/settings", "POST appointments/settings"],
    "TW-APPT-023": ["GET api/appointments/slots", "POST api/appointments/book"],
    "TW-APPT-024": ["GET b/manage/{token}"],
    "TW-APPT-025": [
      "GET b/manage/{token}/slots",
      "GET b/manage/{token}/reschedule",
      "POST b/manage/{token}/reschedule"
    ],
    "TW-APPT-026": ["POST b/manage/{token}/cancel"],
    "TW-APPT-027": ["GET b/pay/callback/{gateway}", "POST b/pay/callback/{gateway}"],
    "TW-APPT-028": [
      "POST appointments/oauth/google/start",
      "POST appointments/oauth/google/disconnect",
      "GET appointments/oauth/google/callback"
    ]
  }
}
```

## Port decisions

Recorded by the API port of appointments and booking. The default was to **fix clear bugs and keep intended behaviour**; every place the port
differs from Reference is a "Differences to decide" row above, all decided as recommended (the project owner asked for the extensions and said to
fix the quirks the code shows). Code: `apps/api/src/modules/appointments-booking`, ports in `apps/api/src/infra/providers/appointments-booking`,
contracts in `packages/contracts/src/appointments/`, migrations `20261012090000_appt_model_reshape.sql`, `20261012090100_appt_permissions.sql` and `20261012090200_appt_created_by.sql`,
tests in `apps/api/test/{unit,integration,e2e}/appointments-booking`, endpoints in `docs/api/appointments-booking.md`.

### Where things live

The module is `modules/appointments-booking` (the ownership zone), its own Nest module importing `CrmModule` (contacts) and `PlansCoreModule`,
registered in `app.module.ts`; the worker side (`AppointmentsBookingWorkerModule`: reminder sweep, lifecycle sweep, message and calendar
consumers) in `workers.module.ts`. Contracts are in `packages/contracts/src/appointments/` (the path the web agent was told; the ownership
file names `appointments-booking/`, a follow-up to reconcile). The shared seams touched, all additive: `app.module.ts`,
`workers.module.ts`, the contracts `index.ts` and `common/errors.ts` (the `APPT_*` codes), the plan registry `catalogue.ts` (feature
`appointment_booking`, default on; limit `appointments`, default unlimited) and the Agent grants in sign-up provisioning and the dev seed.
**The web plan editor needs its labels** (`plans.editor.featureKeys.appointment_booking`, `plans.editor.limitKeys.appointments`, en and ar,
in `auth-registration-security.platform.json`, and the account plan card) or its messages test fails: that is `apps/web`, not touched here.

### Status machine (EXT-APPT-04, D-04)

| From                | Action           | To        | Notes                                                                                      |
| ------------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------ |
| (new)               | book             | confirmed | no approval and nothing due now                                                            |
| (new)               | book             | pending   | approval required, or an amount due now (then `payment_status = pending`, hold 30 minutes) |
| pending             | confirm          | confirmed | staff                                                                                      |
| pending             | decline          | declined  | staff or the sweep (a request whose time passed); frees the slot                           |
| pending             | payment recorded | confirmed | when approval is not required; otherwise stays pending for approval                        |
| pending / confirmed | cancel           | cancelled | staff, invitee (manage link) or system (unpaid hold expired); frees the slot               |
| confirmed           | check-in         | confirmed | stamps `checked_in_at`; the sweep completes it after it ends                               |
| confirmed           | complete         | completed | only once it has started                                                                   |
| confirmed           | no-show          | no_show   | only once it has started; records the no-show fee                                          |

Terminal: cancelled, declined, completed, no_show. Reschedule is allowed for pending and confirmed, not started, and keeps the status.

### Data model reshape (migration `20261012090000_appt_model_reshape.sql`)

- `btree_gist`; `appointments.seat` and an **exclusion constraint** `(org_id =, booking_type_id =, seat =, tstzrange(starts_at, ends_at) &&)` over pending and confirmed rows replace `active_slot_key`; `starts_at` and `ends_at` NOT NULL with `ends_at > starts_at`.
- Dropped as dead or replaced: `staff_id` (both tables), `capacity_used`, `reminders_sent`, `active_slot_key`, `manage_token`.
- Added to `appointments`: `created_by` (migration `...090200`, so the record scope `own` means "I host it or I booked it"), `invitee_name|email|phone`, `notes` (encrypted), `manage_token_hash` (unique) and `manage_token_cipher`, `armed_at`, `needs_review`, `status_changed_at`, `cancelled_by`, `cancel_reason`, `cancelled_at`, `price_minor`, `currency`, `due_now_minor`, `fee_recorded_minor`, `hold_expires_at`; status and field CHECKs; `google_event_id` and `google_calendar_id` renamed `calendar_event_id` and `calendar_id`.
- Added to `booking_types`: `approval_required`, ranges and format CHECKs, `whatsapp` location type; `booking_templates.channel` gains `email`.
- New `appointment_reminder_runs` (unique per appointment, reminder and offset): the idempotent claim of the sweep.
- Permission keys `record.booking-types.*` and `record.appointments.*` (migration `20261012090100`).

### Slot engine (D-01, D-02, D-03)

Pure functions in `slot-engine.ts` and `tz.ts`: for each local calendar date in the type zone from today through `today + max_advance_days - 1`,
the day's windows (the date's override replaces the weekly intervals; a closed override removes them) become instants (a nonexistent wall time
shifts forward by the gap, a repeated one takes its first occurrence); slots step by `increment` real minutes while `start + duration <= window
end`; a slot needs `start >= now + min_notice`; per seat (1..capacity), a slot is free when no active booking of the type on that seat
buffer-overlaps it (busy start `<` slot end + buffer after, and busy end `>` slot start - buffer before) and no calendar busy interval does;
live reservations take seats away; `remaining = free seats - reservations`; `max_per_day` removes a day's slots once that many bookings start that
local day. Staff may book with `ignoreAvailability`, which skips the grid, notice, horizon and day cap but never a seat or the exclusion constraint.

### Other decisions

| Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Where                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Ids on the wire, in audit rows and events are uuids; invitee data never appears in a public response or an event payload beyond what the consumer needs to send the message (the message port gets it from the row at delivery).                                                                                                                                                                                                                                            | all                   |
| Public pages: `/v2/public/booking/:orgSlug/...` (browse, slots, book) and `/v2/public/booking-manage/:token/...`; `@Public`, `no-store`, `noindex`, throttled per IP and per link on Redis (fail-open, as sales-docs), unknown token 404, a name and an email or phone required to book, the same invitee booking the same slot again returns the existing booking (`replay`).                                                                                              | EXT-APPT-01           |
| A payment hold (30 minutes) is set only when the type names a gateway; with none the booking waits for staff instead of expiring under a customer who has nowhere to pay.                                                                                                                                                                                                                                                                                                   | TW-APPT-027           |
| The monthly plan cap is an entitlement `appointments` (default 0 = unlimited) and the gate a feature `appointment_booking` (default on), both in `PLAN_*_DEFS`.                                                                                                                                                                                                                                                                                                             | TW-APPT-001, 035      |
| Contact link: an existing `contactId`, or find-or-create by canonical phone and email through `ContactsService.create` (identity-first) before the booking transaction; a contact-quota failure does not block the booking (it is stored on the appointment). Existing contacts are not modified.                                                                                                                                                                           | TW-APPT-033           |
| Events never carry the invitee's name, the notes or the manage link, and the booking's `title` (made of the customer's name) is left out of events and out of the public manage view (which shows the service name instead): a consumer reads the booking at delivery. A test fails if any of them appears in an event or in a public response.                                                                                                                             | all                   |
| Reminders: a worker sweep every 60 s claims `(appointment, reminder, offset)` rows with `ON CONFLICT DO NOTHING` and emits `appointment.reminder_due` in the same transaction; a reminder fires only for confirmed bookings, when its time has come, the booking has not started and its time is later than the moment the booking was made or moved (`armed_at`, Reference's "skip when already past"); a reschedule deletes the booking's claims so every offset re-arms. | TW-APPT-030           |
| Messages: consumers turn `booked`, `rescheduled`, `cancelled`, `reminder_due` into `AppointmentMessenger.send` calls with the type's template for that event (plain body with `{{type}} {{slot}} {{name}} {{date}} {{time}} {{location}} {{manage_link}}`, legacy `{title}`/`{time}`/`{date}` accepted) or a default text; the stub adapter reports `skipped`.                                                                                                              | D-14                  |
| Calendar: consumers call `CalendarSyncPort` (create, update, delete, free/busy) and write the returned event id and Meet URL back; the stub adapter is "not connected"; free/busy is added to the busy set for types that name a calendar. Google OAuth, the calendar picker, event write and free/busy are built here (`GoogleCalendarAdapter`); the Sheets append is `blocked`.                                                                                           | D-08                  |
| Appointments are hard-deleted only in a final status (audited, `appointment.deleted`).                                                                                                                                                                                                                                                                                                                                                                                      | TW-APPT-039           |
| The chat flow's side is a service, not HTTP: `BookingOffersService` (offer with the plan gate, days then times nine to a page, a ten-minute `reserve`, `book` as actor `bot`) replaces `/api/booking/*` and its shared secret.                                                                                                                                                                                                                                              | TW-APPT-019..021, 034 |
| Not built: storage for the workspace settings screen (D-16): no `GET/PUT /appointments/settings`; a booking type carries what the screen's windows and rules were.                                                                                                                                                                                                                                                                                                          | TW-APPT-022, 023      |

### Not built here (follow-ups)

| What                                                                                                 | Why / where it goes                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheets append                                                                                        | `blocked`: the Sheets scope is not requested; the spreadsheet columns are stored. Google OAuth, the calendar picker, event write and free/busy are built (item 19 of `parity/product-extensions.md`) |
| The flow node and its trigger (`appointment_booked`)                                                 | flow domains call `BookingOffersService` / `AppointmentsService.book` and subscribe to `appointment.booked`                                                                                          |
| A payment gateway adapter and invoice linkage for paid bookings                                      | payments domain consumes `appointment.payment_due` and calls `recordPayment`                                                                                                                         |
| Real WhatsApp / email delivery of booking messages                                                   | channel domains replace the stub `AppointmentMessenger`                                                                                                                                              |
| Org-wide holidays, staff calendars, cross-type conflicts, reservations over HTTP, recurring bookings | not in Reference; reservations are a service method for the chat flow                                                                                                                                |
| Web screens                                                                                          | the web agent builds them against the contracts                                                                                                                                                      |
