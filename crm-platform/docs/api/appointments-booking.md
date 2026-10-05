# API: appointments and booking

Domain `appt` (WD-APPT-001 .. 040, EXT-APPT-01 .. 08). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the codes this domain adds are the `APPT_*` and `BOOKING_TYPE_HAS_UPCOMING` entries in `@crm/contracts`
`common/errors.ts`. Request and response shapes live in `packages/contracts/src/appointments/`. Live docs: `/docs`. Every id on the wire is a
uuid. Decisions where the port differs from WaDesk: "Port decisions" in `docs/wadesk-port/inventory/appointments-booking.md`.

Three groups of routes:

- **Staff** (`/booking-types`, `/appointments`, `/contacts/:id/appointments`): a staff bearer token, the plan's **appointment booking**
  (`422 PLAN_FEATURE_LOCKED` otherwise, reads included) and the capability in brackets. POST routes marked _idempotent_ take an
  `Idempotency-Key`.
- **Public booking page** (`/public/booking/...`): no token. A workspace's own page, found by its slug.
- **Public manage link** (`/public/booking-manage/<token>/...`): no token header; the 43-character token in the path is the credential.

## Capabilities

| Key                           | Scope | Grants                                                                                                 |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `record.booking-types.read`   | no    | list, get, options, slots of a type, the stateless preview                                             |
| `record.booking-types.create` | no    | create a booking type                                                                                  |
| `record.booking-types.update` | no    | edit, pause, edit hours, questions, reminders, messages, price, calendar target, date overrides        |
| `record.booking-types.delete` | no    | delete a booking type                                                                                  |
| `record.appointments.read`    | yes   | list, counts, get, ICS, calendar status, a contact's appointments                                      |
| `record.appointments.create`  | no    | book an appointment for a customer                                                                     |
| `record.appointments.update`  | yes   | edit, reschedule, confirm, decline, cancel, complete, no-show, check-in, record a payment, rotate link |
| `record.appointments.delete`  | yes   | delete an appointment in a final status                                                                |

The Admin preset holds all eight. The editable front-line preset (`Agent` from sign-up, `Counsellor` from the dev seed) gets read on
booking types, and read (own), create, update (own) on appointments. "scope" means the caller's record scope applied to **who hosts or
booked** the appointment: `own` is "I host it or I booked it", `team` adds people who share a team with me, `all` is the workspace. An
appointment outside the scope is `404`, never `403`. A contact's list also needs `record.contacts.read` on the contact (its own scope
applies). Attaching a contact to an appointment needs `record.contacts.read` on it.

The Admin and Agent grants are inserted by migration `20261012090100` for existing organizations and by the sign-up provisioning and the
dev seed for new ones; a running environment sees the keys when the 10-minute grant cache expires (or after flushing the `rbac:*` Redis keys).

## The booking type

```json
{
  "id": "5c1e…",
  "name": "Consultation",
  "slug": "consultation",
  "description": "A first call",
  "locationType": "virtual",
  "locationValue": "https://meet.example/x",
  "color": "#075E54",
  "introMessage": null,
  "durationMinutes": 45,
  "incrementMinutes": 15,
  "bufferBeforeMinutes": 10,
  "bufferAfterMinutes": 5,
  "minNoticeMinutes": 240,
  "maxAdvanceDays": 30,
  "maxPerDay": 6,
  "capacity": 2,
  "timezone": "Asia/Kolkata",
  "effectiveTimezone": "Asia/Kolkata",
  "approvalRequired": false,
  "isActive": true,
  "sortOrder": 0,
  "host": { "id": "…", "name": "Ana" },
  "publicPath": "/book/acme/consultation",
  "publicUrl": "https://app.example/book/acme/consultation",
  "availability": [{ "weekday": 1, "from": "09:00", "to": "12:00" }],
  "overrides": [
    { "date": "2026-12-25", "isClosed": true, "from": null, "to": null, "reason": "Holiday" }
  ],
  "questions": [
    {
      "id": "…",
      "label": "Company",
      "type": "text",
      "options": null,
      "required": true,
      "mapToContactField": "name",
      "sortOrder": 0
    }
  ],
  "reminders": [{ "id": "…", "offsetMinutes": 1440, "label": "24h", "isActive": true }],
  "templates": [
    {
      "event": "reminder",
      "channel": "whatsapp",
      "waTemplateId": null,
      "plainBody": "See you {{slot}}",
      "variableMap": null
    }
  ],
  "payment": {
    "currency": "USD",
    "fee": "100.00",
    "taxPercent": "10",
    "total": "110.00",
    "gatewaySlug": "stripe",
    "depositMode": "partial",
    "deposit": "30.00",
    "dueNow": "30.00",
    "autoSendLink": true,
    "cancelFee": "5.00",
    "noShowFee": "0.00",
    "cancelWindowMinutes": 120
  },
  "calendar": {
    "calendarId": "team@example.com",
    "createMeet": true,
    "spreadsheetId": null,
    "sheetRange": "Sheet1!A1"
  },
  "appointmentsCount": 12,
  "upcomingCount": 3,
  "rowVersion": 4,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`weekday` is `0` Sunday to `6` Saturday; `from` / `to` are `HH:MM` (24-hour) in the type's zone; intervals of one weekday may not overlap.
`timezone` null follows the workspace zone (`organizations.settings.timezone`, UTC when unset). Money is a **decimal string in major units**
with the currency's own decimals (`JPY` none, `KWD` three); more decimals is `422 APPT_AMOUNT_INVALID`, and so is a partial deposit above
the total. `locationType` is `address | virtual | phone | whatsapp`. `slug` is made unique per workspace by a numeric suffix.

Template variables: `{{type}} {{slot}} {{name}} {{date}} {{time}} {{location}} {{manage_link}}` (the legacy `{title} {time} {date}` also work).

### Booking-type routes

| Route                                       | Capability                    | Notes                                                                                                  |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /booking-types`                        | `record.booking-types.read`   | all types (up to 200), newest first; filters `q` (name), `active`                                      |
| `GET /booking-types/options`                | `record.booking-types.read`   | `[{ id, name, durationMinutes, isActive }]`: the flow builder's "Service" picker                       |
| `POST /booking-types/preview-slots`         | `record.booking-types.read`   | `{ draft, days }` (1-14): the slots an unsaved draft would offer; bookings and holds not counted       |
| `POST /booking-types`                       | `record.booking-types.create` | _idempotent_; 201; the type and every child in one body                                                |
| `GET /booking-types/:id`                    | `record.booking-types.read`   |                                                                                                        |
| `GET /booking-types/:id/slots`              | `record.booking-types.read`   | `from`, `to` local dates (at most 62 days, default 14 from today); the slots as the customer sees them |
| `PATCH /booking-types/:id`                  | `record.booking-types.update` | needs `rowVersion` (409 `ROW_VERSION_CONFLICT`); absent keeps; a child list that is sent replaces it   |
| `PUT /booking-types/:id/overrides/:date`    | `record.booking-types.update` | `{ isClosed, from?, to?, reason? }`: one date, the rest untouched                                      |
| `DELETE /booking-types/:id/overrides/:date` | `record.booking-types.update` | 404 when the date has no override                                                                      |
| `DELETE /booking-types/:id`                 | `record.booking-types.delete` | 204; `409 BOOKING_TYPE_HAS_UPCOMING` while pending or confirmed bookings are still to come             |

Literal paths (`options`, `preview-slots`) are registered before `:id`. **Children**: `questions` and `reminders` items that carry an `id`
keep their row (ids stay stable across edits); items without one are created; rows not named are deleted. `availability`, `overrides` and
`templates` are replaced as lists. Pausing is `PATCH { isActive: false }`. A capacity cut below the seats of bookings still to come is 422.

### Slots

```json
{
  "timezone": "Asia/Kolkata",
  "durationMinutes": 30,
  "days": [
    {
      "date": "2026-10-05",
      "slots": [
        { "start": "2026-10-05T03:30:00.000Z", "end": "2026-10-05T04:00:00.000Z", "remaining": 1 }
      ]
    }
  ]
}
```

Computed live from the facts; nothing is cached. The rules (the full text is in the inventory): the horizon is `maxAdvanceDays` calendar
days with today as the first; a slot starts at or after now + `minNoticeMinutes`; slots step by `incrementMinutes` real minutes inside each
interval and must fit the duration; a date override replaces that date's weekly intervals (closed = none); each **seat** (1 .. capacity)
is blocked by an active booking that overlaps `[start - bufferBefore, end + bufferAfter)`; live reservations hold seats; `maxPerDay` stops
a day once that many bookings start on it; the calendar port's busy intervals block every seat. **Daylight saving:** a wall time becomes an
instant (a time inside the spring-forward gap shifts forward, a repeated time takes its first occurrence) and slots then step in real
elapsed minutes, so a 23-hour day offers 23 hours and a 25-hour day 25.

## The appointment

```json
{
  "id": "…",
  "status": "confirmed",
  "title": "Consultation — Ana Rao",
  "description": null,
  "startsAt": "2026-10-05T03:30:00.000Z",
  "endsAt": "2026-10-05T04:15:00.000Z",
  "timezone": "Asia/Kolkata",
  "inviteeTimezone": null,
  "location": "https://meet.example/x",
  "meetUrl": null,
  "bookingType": {
    "id": "…",
    "name": "Consultation",
    "color": "#075E54",
    "durationMinutes": 45,
    "locationType": "virtual"
  },
  "seat": 1,
  "invitee": { "name": "Ana Rao", "email": "ana@example.com", "phone": "+919800000001" },
  "contact": { "id": "…", "name": "Ana Rao" },
  "host": { "id": "…", "name": "Ben" },
  "source": "manual",
  "answers": [{ "questionId": "…", "label": "Company", "type": "text", "value": "Acme" }],
  "notes": "Wants the early slot",
  "payment": {
    "status": "pending",
    "currency": "USD",
    "total": "110.00",
    "dueNow": "30.00",
    "paid": "0.00",
    "feeRecorded": "0.00",
    "holdExpiresAt": null
  },
  "needsReview": false,
  "checkedInAt": null,
  "statusChangedAt": "…",
  "cancelledAt": null,
  "cancelledBy": null,
  "cancelReason": null,
  "calendar": { "eventId": null, "calendarId": null },
  "manageUrl": "https://app.example/b/manage/<token>",
  "rowVersion": 2,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`status` is `pending | confirmed | cancelled | declined | completed | no_show`. `source` is `chat | link | manual | api`. `notes` are encrypted
at rest and returned decrypted; they are never in an audit row or an event. Times are instants; `timezone` is the booking type's zone at the
time of booking (what staff read the time in). `payment.status` is `none | pending | partial | paid | refunded`.

### The status machine

| From                | Action                   | To                     | Notes                                                                                                        |
| ------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| (new)               | book                     | `confirmed`            | staff always; the public page and flows when no approval is needed and nothing is due now                    |
| (new)               | book (public page, flow) | `pending`              | approval required, or an amount due now (then `payment.status = pending`, hold 30 min if a gateway is named) |
| `pending`           | `confirm`                | `confirmed`            |                                                                                                              |
| `pending`           | `decline`                | `declined`             | frees the slot; also the sweep, for a request whose time has passed                                          |
| `pending`           | payment recorded         | `confirmed`            | when what is due is paid and approval is not required                                                        |
| `pending/confirmed` | `cancel`                 | `cancelled`            | staff, the customer (manage link) or the system (unpaid hold expired); frees the slot                        |
| `confirmed`         | `complete`, `no-show`    | `completed`, `no_show` | only once the appointment has started (`409 APPT_NOT_STARTED`)                                               |
| `confirmed`         | `check-in`               | `confirmed`            | stamps `checkedInAt`; idempotent; the worker completes a checked-in booking after it ends                    |

Any other move is `409 APPT_INVALID_TRANSITION` with `from` and `to`. The four final statuses have no way out. The slot is held by
`pending` and `confirmed` only: the status change that ends a booking frees the slot in the same statement.

### Appointment routes

| Route                                                                              | Capability                   | Notes                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /appointments`                                                                | `record.appointments.read`   | cursor-paged (limit 1-200, default 50). `scope` `upcoming` (default: not started, pending or confirmed, soonest first), `past`, `all`; `status` list, `bookingTypeId`, `contactId`, `hostId`, `mine`, `from`/`to` (the start), `needsReview`, `q` (title, invitee name, email, phone), `order` |
| `GET /appointments/counts`                                                         | `record.appointments.read`   | per status, `upcoming`, `past`, `needsReview`, `mine.upcoming`: the tab badges. Same filters as the list except `status` and `scope`                                                                                                                                                           |
| `GET /appointments/calendar`                                                       | `record.appointments.read`   | `{ provider, connected, account, status, calendarId, calendarName, connectedAt }`: `status` is `unavailable` (the platform has no Google client), `disconnected`, `connected` or `needs_reconnect`. See Google Calendar                                                                        |
| `POST /appointments`                                                               | `record.appointments.create` | _idempotent_; 201. `bookingTypeId`, `startsAt`, `contactId` or `invitee`, `notes`, `answers`, `hostId`, `ignoreAvailability`, `notify`                                                                                                                                                         |
| `GET /appointments/:id`                                                            | `record.appointments.read`   | includes `manageUrl`                                                                                                                                                                                                                                                                           |
| `GET /appointments/:id/ics`                                                        | `record.appointments.read`   | `text/calendar` attachment                                                                                                                                                                                                                                                                     |
| `PATCH /appointments/:id`                                                          | `record.appointments.update` | needs `rowVersion`; `title`, `description`, `location`, `notes`, `hostId`, `contactId`, `invitee`; `null` clears                                                                                                                                                                               |
| `POST /appointments/:id/reschedule`                                                | `record.appointments.update` | `{ startsAt, ignoreAvailability?, notify?, rowVersion? }`; pending or confirmed, not started; keeps the status                                                                                                                                                                                 |
| `POST /appointments/:id/cancel`                                                    | `record.appointments.update` | `{ reason?, notify?, rowVersion? }`                                                                                                                                                                                                                                                            |
| `POST /appointments/:id/confirm`, `/decline`, `/complete`, `/no-show`, `/check-in` | `record.appointments.update` | `{ reason?, notify?, rowVersion? }`                                                                                                                                                                                                                                                            |
| `POST /appointments/:id/payments`                                                  | `record.appointments.update` | _idempotent_; `{ amount, method?, reference? }` in the booking's currency; see Payments                                                                                                                                                                                                        |
| `POST /appointments/:id/manage-link/rotate`                                        | `record.appointments.update` | `{ manageUrl }`; the old link stops working at once                                                                                                                                                                                                                                            |
| `DELETE /appointments/:id`                                                         | `record.appointments.delete` | 204; `409 APPT_NOT_DELETABLE` unless the status is final; audited, `appointment.deleted`                                                                                                                                                                                                       |
| `GET /contacts/:id/appointments`                                                   | `record.appointments.read`   | that contact's appointments; the list's filters and paging                                                                                                                                                                                                                                     |

**Booking** (`POST /appointments`, the public page, a flow): validated by the slot engine under a per-(workspace, type) lock.
`409 APPT_SLOT_TAKEN` when the seat was just taken, `422 APPT_SLOT_UNAVAILABLE` when the time is not one the type offers, `422
APPT_ANSWERS_INVALID` (one detail per question) when an answer is missing, of the wrong format or not a choice, `422 PLAN_LIMIT_REACHED`
when the month's plan cap is reached (staff; the public page says "not available"). `ignoreAvailability` (staff) skips the grid, the notice,
the horizon and the day cap but **never a taken seat** (the database refuses an overlapping booking of the same seat regardless). The
invitee is matched to or made into a contact by canonical phone and email (identity-first, through the contacts service), before the
booking transaction; a contact cap never blocks the booking. A mapped answer fills an invitee field the invitee left empty.

**Double booking.** Prevented twice: the application lock re-runs the engine under it (buffers, capacity, day cap, reservations), and the
database's exclusion constraint on (type, seat, time range) over `pending` and `confirmed` rows refuses any overlap, even if two workers race
or a code path forgets the lock. Verified with parallel requests: 12 simultaneous bookings of one slot give exactly one 201 and eleven `409`;
9 for a 3-seat slot give three on seats 1, 2, 3.

**Payments.** No gateway is built. A type with an amount due to book creates a `pending` booking (`payment.status = pending`) and emits
`appointment.payment_due` (amount, currency, `gatewaySlug`, hold expiry); with a gateway named, the slot is held for 30 minutes (the worker
cancels an unpaid hold). `POST /appointments/:id/payments` (or `AppointmentsService.recordPayment` for the payments domain) records money
received: `payment.status` becomes `partial` or `paid`, and when what is due to book is paid a pending booking is confirmed (unless the type
needs approval, which stays a staff decision). More than the price, a free booking and a final-status booking are refused. Cancel and
no-show fees are only **recorded** (`payment.feeRecorded`): the customer's cancel inside the type's cancel window, and a no-show.

## The customer's side (no login)

Responses carry `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. Throttled on Redis per IP and
per target (fixed one-minute windows, fail-open): browsing 120 per IP / 240 per page, booking **10 per IP / 60 per page**, manage reads
120 / 60 per link, manage writes 20 / 10 per link; over the limit is `429 RATE_LIMITED` with `errors[0].path = retryAfterSeconds`. A
workspace whose plan lacks booking is `409 APPT_BOOKING_UNAVAILABLE` (no upgrade hint); an unknown workspace, service (or a paused one) or
token is `404`.

| Route                                           | Notes                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/booking/:orgSlug`                  | `{ organization: { name, slug }, services: [...] }`: active services with price, questions and time zone. No staff or customer data |
| `GET /public/booking/:orgSlug/:typeSlug`        | one service (same shape) with the organization                                                                                      |
| `GET /public/booking/:orgSlug/:typeSlug/slots`  | `from`, `to` local dates; same shape as the staff slots                                                                             |
| `POST /public/booking/:orgSlug/:typeSlug/book`  | 201. `{ startsAt, name, email?, phone?, timezone?, notes?, answers? }`; a name and an email **or** phone are required               |
| `GET /public/booking-manage/:token`             | the booking: status, service, time, place, `canCancel`, `canReschedule`, `cancelFee`. **No customer data and no ids**               |
| `GET /public/booking-manage/:token/slots`       | slots to move to (the booking's own slot is free for it); 410 when the booking is over                                              |
| `GET /public/booking-manage/:token/ics`         | `text/calendar`                                                                                                                     |
| `POST /public/booking-manage/:token/reschedule` | `{ startsAt }`: must be an offered slot (`409 APPT_SLOT_TAKEN`, `422 APPT_SLOT_UNAVAILABLE`); returns the manage view               |
| `POST /public/booking-manage/:token/cancel`     | `{ reason? }`; returns the manage view                                                                                              |

The book response is `{ status, startsAt, endsAt, timezone, requiresApproval, paymentDue, manageToken, manageUrl, replay }`. The same visitor
(same email or phone) booking the same slot again gets their booking back with `replay: true`. The manage token is 256 random bits
(43 base64url characters); only its SHA-256 is stored (an encrypted copy lets staff copy the link), the lookup is by hash, and a malformed
token is rejected before any query. `GET` never changes anything. A booking that is cancelled, declined, completed or no-show is `410
APPT_LINK_UNAVAILABLE` for slots, reschedule and cancel (the page itself still shows the outcome); after its start `409 APPT_ALREADY_STARTED`.

## Events (outbox) and what consumes them

Written in the same transaction as the change, with an audit row (module `appointments` / `booking_types`). Payloads carry identifiers and
what a consumer decides on, **never** the notes, the manage link or the invitee's name, email or phone (a consumer reads the booking at delivery).

| Event                                          | When                                                  | Extra payload                                              |
| ---------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `appointment.booked`                           | a booking is made (any status)                        | `requiresApproval`, `paymentDue`, `notify`                 |
| `appointment.confirmed`                        | pending to confirmed (staff, or a payment)            | `from`, `by`, `reason`, `notify`                           |
| `appointment.declined`                         | a request declined (staff, or expired)                | `from`, `by`, `reason`, `notify`                           |
| `appointment.cancelled`                        | cancelled (staff, customer, system)                   | `from`, `by`, `reason`, `notify`, `feeRecorded`            |
| `appointment.rescheduled`                      | moved                                                 | `previousStartsAt`, `by`, `notify`                         |
| `appointment.completed`, `appointment.no_show` | closed (staff, or the sweep for a checked-in booking) | `from`, `by`, `reason`, `notify`, `feeRecorded`            |
| `appointment.reminder_due`                     | the sweep claims a (booking, offset)                  | `offsetMinutes`, `dueAt`, `startsAt`, `endsAt`, `timezone` |
| `appointment.payment_due`                      | a booking with an amount due to book is made          | `amount`, `currency`, `gatewaySlug`, `holdExpiresAt`       |
| `appointment.payment_received`                 | a payment is recorded                                 | `amount`, `currency`, `method`, `reference`                |
| `appointment.deleted`                          | a final-status booking is deleted                     |                                                            |
| `booking_type.created`, `.updated`, `.deleted` | a type changes                                        | `uuid`, `name`, `slug`, `isActive`                         |

Every appointment event also carries `uuid`, `status`, `startsAt`, `endsAt`, `timezone`, `bookingTypeId`, `contactId`, `hostId`, `source`,
`paymentStatus`, `rowVersion`. `notify: false` (a silent staff action) tells the message consumer to send nothing.

## Workers (the worker process; `AppointmentsBookingWorkerModule`)

- **Reminder sweep**, every 60 s, privileged: claims `(appointment, offset)` pairs with `INSERT ... ON CONFLICT DO NOTHING` on
  `appointment_reminder_runs` and writes `appointment.reminder_due`, in one transaction. A reminder fires for a **confirmed** booking that has
  not started, once `start - offset` has come, and only if that time is later than when the booking was made or last moved (`armed_at`):
  WaDesk's "skip when booked inside the window". An inactive offset never fires. A reschedule deletes the booking's claims, so every offset is
  armed again. Two workers sweeping at once announce each reminder exactly once.
- **Lifecycle sweep**, every 60 s: expires reservations; flags confirmed bookings that ended 15+ minutes ago with no check-in as
  `needsReview` (it never guesses a no-show); completes checked-in ones; cancels unpaid pending bookings whose hold ran out
  (`cancelledBy: system`, reason `payment_timeout`); declines pending requests whose time has passed (reason `expired`). Changes go through
  the same transition code as a click, as the system actor.
- **Message consumer** (`appointment.booked | confirmed | declined | cancelled | rescheduled | reminder_due`): builds the customer message
  and calls `AppointmentMessenger.send`. The type's plain body for the event (per configured channel) or the default text; WhatsApp when
  there is a phone, else email; the booking is re-read at delivery (a stale message is dropped; a pending request is not "confirmed").
  Idempotency key `<outbox event id>:<channel>`.
- **Calendar consumer** (`booked | confirmed | rescheduled | cancelled | declined`): writes or updates the event for a confirmed booking
  and stores `calendar.eventId` and `meetUrl`; deletes it on cancel or decline. A failure throws (the drain retries); the port is idempotent
  on the stored event id (and, before there is one, on the appointment: see Google Calendar). Nothing happens when no calendar is
  connected or the grant needs reconnecting.

## Google Calendar (WD-APPT-012, 028, 029; D-08)

One Google account per workspace, connected by an admin through Google's consent screen. The **platform operator** supplies the Google
OAuth client once for everyone (console, _Admin, Settings, Google Calendar_: client id, client secret, optional redirect URI override,
and a switch); a workspace never sees them. Setting that client up in Google Cloud: `docs/runbooks/google-calendar-setup.md`.

**What is asked of Google:** `openid`, `email`, `calendar.events` (write events, Meet), `calendar.freebusy` and
`calendar.calendarlist.readonly`. WaDesk asked for Calendar, Sheets, Docs, Drive and Forms in one consent; only calendar access is asked
here. The consent URL carries `access_type=offline` and `prompt=consent`, so Google issues a refresh token on every consent. A consent with
a calendar scope unticked is withdrawn again and stores nothing (`?calendar=missing_scope`).

### Where the client comes from

The console group `googleCalendar` (`GET|PATCH /platform/settings/groups/googleCalendar`): `enabled` (default on), `clientId`,
`redirectUri` (optional override) and the write-only secret `clientSecret` (sealed, never returned; `secrets.clientSecret.isSet` says
whether one is stored; the response also carries `extra.redirectUri`, the address to register on the Google client). A field left empty
falls back to the environment (`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`); the default
redirect URI is `<APP_URL>/v2/public/appointments/calendar/google/callback`. Without a client (or switched off) every workspace sees
`status: unavailable`.

Environment for the adapter (all optional, defaults are Google's own addresses; they exist so tests can aim at a local stand-in):
`GOOGLE_OAUTH_AUTH_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_OAUTH_REVOKE_URL`, `GOOGLE_USERINFO_URL`, `GOOGLE_CALENDAR_API_URL`,
`GOOGLE_HTTP_TIMEOUT_MS` (8000), `GOOGLE_BUSY_CACHE_SECONDS` (30), `GOOGLE_BUSY_BACKOFF_SECONDS` (20).

### Routes

| Route                                               | Capability                    | Notes                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /appointments/calendar`                        | `record.appointments.read`    | the status (above)                                                                                                                                                                                                                           |
| `POST /appointments/calendar/google/start`          | `record.booking-types.update` | `{ returnTo? }` (a path inside the app); 200 `{ url, expiresInSeconds }`: Google's consent URL, with a signed state good for 10 minutes and bound to the workspace and the admin. `422 APPT_CALENDAR_NOT_CONFIGURED` when there is no client |
| `GET /public/appointments/calendar/google/callback` | none (the signed `state`)     | Google's redirect. Verifies the state, exchanges the code, stores the grant sealed, answers **302** to `<WEB_APP_URL><returnTo>?calendar=<outcome>`. Outcomes: `connected`, `denied`, `failed`, `expired`, `not_configured`, `missing_scope` |
| `GET /appointments/calendar/google/calendars`       | `record.booking-types.update` | the calendars the account can write to (`minAccessRole=writer`), the primary one first. `409 APPT_CALENDAR_NOT_CONNECTED`, `502 APPT_CALENDAR_PROVIDER_FAILED`                                                                               |
| `PUT /appointments/calendar/google/calendar`        | `record.booking-types.update` | `{ calendarId }`, one of the listed ids (else `422`, path `calendarId`); returns the status. Events already written stay where they are                                                                                                      |
| `POST /appointments/calendar/google/disconnect`     | `record.booking-types.update` | revokes at Google (an unreachable Google does not block it), deletes the tokens; idempotent; returns the status                                                                                                                              |

All staff routes also need the plan's appointment booking (`422 PLAN_FEATURE_LOCKED`). Connect, choose, needs-reconnect and disconnect
are each audited (module `appointment_calendar`) and emit `appointment_calendar.connected | calendar_selected | needs_reconnect |
disconnected` in the same transaction as the write. WaDesk also checked the plan feature `integration_google_calendar` on the callback;
the plan registry here has no such key, so the `appointment_booking` flag is the only plan gate (recorded in `parity/product-extensions.md`).

### Storage

`appointment_calendar_connections` (migration `20261019110000`): one row per workspace (forced RLS, composite FK to the admin who connected).
The refresh token and the cached access token are sealed with the credentials key (`CryptoService`, so key rotation applies);
`account_email`, `account_sub`, `scopes`, `calendar_id` (`primary` until chosen), `calendar_name`, `status` (`active` |
`needs_reconnect`) and `status_reason`. A reconnect with the **same** Google account keeps the chosen calendar; another account starts on
its own primary calendar.

### Events

- The Google event id is the appointment uuid without its dashes (Google lets the client pick an id). The first write is an insert with
  that id; if the answer was lost and the outbox retries, Google answers 409 and the adapter updates that same event instead, so a retry
  never doubles an event. When the appointment already stores an event id the write is a patch of it; an event somebody deleted in Google
  is written again under the same id; a cancelled one (Google keeps it as `cancelled`) is restored by the patch.
- Written: summary (the booking type's name), description, location, start and end in the booking's zone, default reminders, the customer
  as attendee (Google emails the invitation when there is an address), and private properties `crmManaged=1` and `crmAppointment=<uuid>`.
- A virtual type (or `createMeet`) asks for a Google Meet room with the appointment uuid as the request id (a repeat is ignored by Google);
  the link comes back as `meetUrl`. If Google has not filled the link in yet the adapter looks once more, then goes on without one.
- Cancel and decline delete the event; a 404 or 410 counts as deleted, so a redelivered delete succeeds. The event is deleted with
  `sendUpdates=all` (the attendee is told it is cancelled).
- Update and delete go to the calendar the event was written to (stored on the appointment), even if the type has been pointed at another
  calendar since.
- A failure throws, so the drain retries with backoff; a request Google refuses as bad (a 400) will not succeed on retry and ends in the
  outbox's dead letters. While the connection is not usable (never connected, `needs_reconnect`, the client removed) the consumer does
  nothing and does not throw: **events for bookings made in that time are not written later; a reconnect does not back-fill.**

### Busy time

`freeBusy` feeds the slot engine (it blocks every seat, buffers included), on the staff, public and flow paths alike. Answers are cached
`GOOGLE_BUSY_CACHE_SECONDS` per workspace, calendar and window, and the cache for a workspace is dropped when this process writes or
deletes an event of that workspace. A Google outage (any failure, a calendar Google cannot find, a timeout) means **no busy data**: the
slots are offered as if there were no calendar, a warning is logged, and bookings are not blocked. After a failure the next calls for
that workspace answer "no busy data" at once for `GOOGLE_BUSY_BACKOFF_SECONDS`, so a dead Google costs one timeout, not one per request.
A booking type that names a calendar id reads that calendar; otherwise the workspace's chosen one.

A group type (capacity above one) is read with `ignoreOwnEvents`: busy blocks that are exactly one of this platform's own events are
removed (the events carry `crmManaged`), so the first booking's event does not close the slot for the other seats. For a one-to-one type
nothing is removed, which keeps WaDesk's behaviour that a booking of one service blocks the same time for another service through the
calendar.

### Tokens and refusals

An access token is refreshed when it is within a minute of expiring and the sealed copy is kept, so the API and the worker do not each
refresh on every call (Google does not rotate refresh tokens, so two processes refreshing at once do no harm; within one process
concurrent refreshes are coalesced). A 401 from the Calendar API refreshes once and repeats the call. **`invalid_grant`** (the grant was
revoked, expired, the password changed, or the app is still in Testing and its 7 days ran out) marks the connection `needs_reconnect` once,
audited, with an outbox event; the settings card then asks for a new consent, and nothing is written to or read from Google until then.
`invalid_client` (the platform's secret is wrong) is not the workspace's fault and does not touch its connection.

### Not verified against real Google

Everything above is exercised against a local stand-in written from Google's documentation (`test/e2e/appointments-booking/fake-google.ts`).
No Google Cloud OAuth client existed when this was built, so nothing has run against Google itself: the consent screen, the refresh-token
behaviour of an app in Testing or Production, Google's real error bodies, Meet creation timing and the `privateExtendedProperty` filter of
`events.list` are taken from the documentation and need a first real run (runbook, "Check it works").

## Ports (what other domains plug in)

| Port (token)                                     | File                                                                      | Stub adapter                         | Who binds the real one                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `CalendarSyncPort` (`APPOINTMENT_CALENDAR`)      | `apps/api/src/infra/providers/appointments-booking/calendar-sync.port.ts` | `NoCalendarSync` (not connected)     | bound here: `GoogleCalendarAdapter` (see Google Calendar) |
| `AppointmentMessenger` (`APPOINTMENT_MESSENGER`) | `.../appointment-messenger.port.ts`                                       | `NoAppointmentMessenger` (`skipped`) | the channel domains (WhatsApp, email)                     |

Override the token in a module (`{ provide: APPOINTMENT_MESSENGER, useClass: ... }`); the stubs are what a deployment has until then.
The calendar port is served by `GoogleCalendarAdapter` (`NoCalendarSync` stays as the reference "nothing connected" behaviour). The Sheets
append is not built (`blocked`: it is the Sheets half of WD-APPT-012 and 029, and its scope is not requested).

**For the flow-runtime domain** (the "Book appointment" node, WD-APPT-034) call `BookingOffersService` (exported from the barrel, no HTTP):
`offer(orgId)` (active types + the gate: `feature_off` / `plan_limit`), `days(orgId, typeId, offset)` and `times(orgId, typeId, date, offset)`
(nine to a page), `reserve(orgId, typeId, startsAt, sessionRef)` (a ten-minute soft lock), `book(orgId, input)` (the same engine and guard,
as actor `bot`, source `chat`). Subscribe to `appointment.booked` for the `appointment_booked` trigger and the notification toggle.
**For the payments domain**: consume `appointment.payment_due`, call `AppointmentsService.recordPayment` when settled.
