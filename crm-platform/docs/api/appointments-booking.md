# API: appointments and booking

Domain `appt` (TW-APPT-001 .. 040, EXT-APPT-01 .. 08). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the codes this domain adds are the `APPT_*` and `BOOKING_TYPE_HAS_UPCOMING` entries in `@crm/contracts`
`common/errors.ts`. Request and response shapes live in `packages/contracts/src/appointments/`. Live docs: `/docs`. Every id on the wire is a
uuid. Decisions where the port differs from Reference: "Port decisions" in `docs/threadwise-port/inventory/appointments-booking.md`.

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
  "reminders": [
    {
      "id": "…",
      "kind": "before",
      "offsetMinutes": 1440,
      "label": "24h",
      "isActive": true,
      "channels": ["whatsapp", "sms", "email"],
      "subject": null,
      "body": null,
      "waTemplateId": null
    }
  ],
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

**Reminder rules** (`reminders`, BL-283). One item per rule; `kind` is `before` (`offsetMinutes` before the start) or `after` (`offsetMinutes`
after the END: the after-visit follow-up); `offsetMinutes` is 1 to 43,200 (30 days) and `(kind, offsetMinutes)` is distinct within a type (the
same minutes before and after are two rules); up to 8 per type. `isActive` defaults to **false**: a rule never sends until it is switched on.
`channels` is an ordered preference over `whatsapp | sms | email` (1 to 3, no repeats; default all three): the first channel that can deliver is
used, the others are fallbacks, a contact never gets two copies. `body` (up to 2000 characters) is the text with the placeholders `{{name}}`,
`{{type}}`, `{{title}}`, `{{slot}}`, `{{date}}`, `{{time}}`, `{{location}}`, `{{join_link}}` and `{{manage_link}}`; empty means the type's own `reminder`
message (before) or the built-in follow-up text (after). `subject` (up to 191) is the email subject. `waTemplateId` is an approved WhatsApp
template of the workspace (422 when it is not); its numbered variables are filled in the order name, service, date, time, place, join link,
manage link. A `PATCH` that names only `reminders` and `rowVersion` changes only the rules.

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
  "calendar": { "eventId": null, "calendarId": null, "sync": null },
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
| `POST /appointments/:id/calendar/push`                                             | `record.appointments.update` | "Push our time back to Google": rewrites the Google event from the appointment (a deleted event returns under its id); `{ appointment, result: { done: 'pushed', applied: null } }`. `409 GOOGLE_SYNC_NOT_DRIFTED`, `409 APPT_CALENDAR_NOT_CONNECTED`, `502 APPT_CALENDAR_PROVIDER_FAILED`     |
| `POST /appointments/:id/calendar/accept`                                           | `record.appointments.update` | "Accept Google's change" `{ notify? }`: re-reads the event and applies it through the usual rules (deleted or missing cancels, moved reschedules, guests acknowledged): `result.applied` is `cancelled`, `rescheduled` or `acknowledged`. `409 GOOGLE_SYNC_NOT_DRIFTED`                        |
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

## Consent line on the booking page (BL-167)

Optional. The workspace writes it per booking type (`PUT /v2/contact-consent/notices/booking/:typeId`, versioned; the Messaging step of the
editor embeds the editor). `GET /public/booking/:org/:type` returns `service.consent { text, version, url }` or `null`. `POST .../book` takes
`consent { given, version }`; only a ticked box at a real, enabled version of that type's notice records a grant (source `booking`, whatsapp for a
phone, email for an address, evidence `bookingTypeId`, `noticeVersion`, `noticeUrl`). Booking itself never needs it and never grants consent.

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

## Booking page appearance (BL-355..BL-358)

How the customer's booking page and manage page look. Three levels, most specific first: a service's override, the workspace booking page theme, the
workspace brand kit (Settings, Branding: primary, accent, background, logo), the product look. Every appearance field is nullable and null means inherit.
Contracts: `packages/contracts/src/appointments/booking-page.ts`. Tables `booking_page_themes`, `booking_page_assets` (forced RLS, `touch_row`).

Staff routes (plan `appointment_booking`; read = `record.booking-types.read`, change = `record.booking-types.update`):

| Method and path                                             | What                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/booking-page/theme`                                | `{ scope, workspaceSlug, typeSlug, theme (saved), resolved (what visitors see), inherited, brand, canRemovePoweredBy, limits }`           |
| `PUT /v2/booking-page/theme`                                | Replaces the saved theme. Needs `rowVersion` (null for the first save) else 409 `ROW_VERSION_CONFLICT`. 422 on a bad colour or text.      |
| `PUT /v2/booking-page/theme/assets/:slot` (`logo`, `cover`) | Multipart `file`: PNG, JPG, WebP, GIF, never SVG; logo 1 MB, cover 3 MB; type checked from the bytes. Returns the theme with the new ref. |
| `DELETE /v2/booking-page/theme/assets/:slot`                | Removes the picture.                                                                                                                      |
| `GET/PUT/DELETE /v2/booking-types/:id/page-theme`           | The service's override (primary and button colour, background style, welcome text, button label). DELETE returns to the workspace look.   |
| `PUT/DELETE /v2/booking-types/:id/page-theme/assets/:slot`  | The service's own logo or cover.                                                                                                          |

Rules: colours are `#RRGGBB` (stored lower case; a CHECK enforces it); fonts, corners, light / dark / auto and background styles are fixed lists; text is plain
text (page title 120, welcome text 600, button label 40 characters) and is never interpreted as markup. Hiding "Powered by" needs the plan feature
`remove_branding` (422 `showPoweredBy` otherwise; a plan that later loses it shows the line again without any save). A cover background with no cover
resolves to solid.

Public: `GET /v2/public/booking/:org`, `/:org/:type` and `GET /v2/public/booking-manage/:token` carry `theme` (the resolved look: colours, wording, switches and
picture refs `{ id, v }`, nothing else; no workspace ids, no staff or customer data). `GET /v2/public/booking-assets/:org/:assetId` serves a picture (`assetId`
is the uuid or `brand-logo`): fixed raster content type, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, ETag, one-year immutable cache
(the `?v=` of the address changes with the file), throttled like any browse of the page. The web relay (`/api/public/appointments/assets/...`) is the only
place the address is built, from the workspace slug and the ref.

Caching: the public pages read a per-workspace bundle from Redis (`appt:page-theme:v1:<orgId>`, 120 s), dropped after every save, upload, removal and reset.
Brand kit and plan changes are made elsewhere, so they show within two minutes (or at the next theme save).

Events: audit module `booking_page_themes` (insert / update / delete, delta of the changed fields) and outbox `booking_page_theme.updated`
`{ scope, bookingTypeId }`. Storage: `booking_page_assets` is a bounded, replace-in-place table classified `system_asset` (not counted) in the storage quota
coverage test, like `workspace_brand_assets`.

## Events (outbox) and what consumes them

Written in the same transaction as the change, with an audit row (module `appointments` / `booking_types`). Payloads carry identifiers and
what a consumer decides on, **never** the notes, the manage link or the invitee's name, email or phone (a consumer reads the booking at delivery).

| Event                                                                     | When                                                  | Extra payload                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `appointment.booked`                                                      | a booking is made (any status)                        | `requiresApproval`, `paymentDue`, `notify`                         |
| `appointment.confirmed`                                                   | pending to confirmed (staff, or a payment)            | `from`, `by`, `reason`, `notify`                                   |
| `appointment.declined`                                                    | a request declined (staff, or expired)                | `from`, `by`, `reason`, `notify`                                   |
| `appointment.cancelled`                                                   | cancelled (staff, customer, system)                   | `from`, `by`, `reason`, `notify`, `feeRecorded`                    |
| `appointment.rescheduled`                                                 | moved                                                 | `previousStartsAt`, `by`, `notify`                                 |
| `appointment.completed`, `appointment.no_show`                            | closed (staff, or the sweep for a checked-in booking) | `from`, `by`, `reason`, `notify`, `feeRecorded`                    |
| `appointment.reminder_due`                                                | the sweep claims a (booking, rule)                    | `kind`, `offsetMinutes`, `dueAt`, `startsAt`, `endsAt`, `timezone` |
| `appointment.reminder_sent`, `_held`, `_skipped`, `_failed`, `_cancelled` | a reminder or follow-up reaches that outcome          | `kind`, `reason` (a stable code), `channel`                        |
| `appointment.payment_due`                                                 | a booking with an amount due to book is made          | `amount`, `currency`, `gatewaySlug`, `holdExpiresAt`               |
| `appointment.payment_received`                                            | a payment is recorded                                 | `amount`, `currency`, `method`, `reference`                        |
| `appointment.deleted`                                                     | a final-status booking is deleted                     |                                                                    |
| `booking_type.created`, `.updated`, `.deleted`                            | a type changes                                        | `uuid`, `name`, `slug`, `isActive`                                 |

Every appointment event also carries `uuid`, `status`, `startsAt`, `endsAt`, `timezone`, `bookingTypeId`, `contactId`, `hostId`, `source`,
`paymentStatus`, `rowVersion`. `notify: false` (a silent staff action) tells the message consumer to send nothing.

## Workers (the worker process; `AppointmentsBookingWorkerModule`)

- **Reminder sweep**, every 60 s, privileged, two halves (BL-283). **Claim**: inserts a `pending` run in `appointment_reminder_runs` for every
  `(appointment, active rule)` whose time has come, with `INSERT ... ON CONFLICT DO NOTHING` on `(appointment, kind, offset, armed_at)`, and
  writes `appointment.reminder_due`, in one transaction. A `before` rule fires for a **confirmed** booking that has not started, once `start - offset`
  has come, and only if that time is later than when the booking was made or last moved (`armed_at`): Reference's "skip when booked inside the
  window". An `after` rule fires for a **confirmed or completed** booking once `end + offset` has come, and not more than a day late. A switched-off
  rule never fires. A reschedule moves the booking's `armed_at`, which makes every rule claimable again for the new time; the runs still waiting for
  the old time are `cancelled / rescheduled`. A cancel, decline or no-show cancels what was waiting. Two workers sweeping at once claim each run
  exactly once. **Deliver**: takes the waiting runs (`pending`, or `held` whose time has come) with `FOR UPDATE SKIP LOCKED`, and for each, from the
  booking and the rule as they are NOW: drops it if the rule was removed or switched off, the booking was moved, cancelled, declined or marked
  no-show, a reminder is at or within two minutes of the start, or a follow-up is over a day late; otherwise tries the rule's channels in order
  through the messenger and records the outcome (`sent` with the channel, `held` with when to look again, `skipped` or `failed` with a reason code)
  on the run, in the audit log (`appointment_reminder_runs`), on the contact's timeline (`appointment_reminder` activity; the outcome and reason,
  never the text or an address) and as `appointment.reminder_<outcome>`. A run found `sending` more than ten minutes after it was taken (a worker
  died mid-delivery) is closed `failed / interrupted` and not retried: a duplicate SMS or email is worse than a missed one.
- **Lifecycle sweep**, every 60 s: expires reservations; flags confirmed bookings that ended 15+ minutes ago with no check-in as
  `needsReview` (it never guesses a no-show); completes checked-in ones; cancels unpaid pending bookings whose hold ran out
  (`cancelledBy: system`, reason `payment_timeout`); declines pending requests whose time has passed (reason `expired`). Changes go through
  the same transition code as a click, as the system actor.
- **Message consumer** (`appointment.booked | confirmed | declined | cancelled | rescheduled`): builds the customer message
  and calls `AppointmentMessenger.send`. The type's plain body for the event (per configured channel) or the default text; with nothing
  configured, WhatsApp when there is a phone and then email when there is an address (the first that delivers wins); the booking is re-read at
  delivery (a stale message is dropped; a pending request is not "confirmed"). Idempotency key `<outbox event id>:<channel>`. A `held` or `failed`
  answer throws, so the drain retries with backoff. (Reminders and follow-ups are no longer sent from here: the deliver half of the sweep does.)
- **Calendar consumer** (`booked | confirmed | rescheduled | cancelled | declined`): writes or updates the event for a confirmed booking
  and stores `calendar.eventId` and `meetUrl`; deletes it on cancel or decline. A failure throws (the drain retries); the port is idempotent
  on the stored event id (and, before there is one, on the appointment: see Google Calendar). Nothing happens when no calendar is
  connected or the grant needs reconnecting; the events missed then are written later by the **back-fill** (below).
- **Calendar back-fill consumer** (`appointment_calendar.connected | provider_selected`): queues the workspace's back-fill job (queue
  `calendar-backfill`, one workspace per job): see "Back-fill after a reconnect".
- **iCal feed read** (every minute the scheduler claims the due feeds; queue `calendar-ics-refresh`, one feed per job): see "iCal calendars".

## Google Calendar (TW-APPT-012, 028, 029; D-08)

One Google account per workspace, connected by an admin through Google's consent screen. The **platform operator** supplies the Google
OAuth client once for everyone (console, _Admin, Settings, Google Calendar_: client id, client secret, optional redirect URI override,
and a switch); a workspace never sees them. Setting that client up in Google Cloud: `docs/runbooks/google-calendar-setup.md`.

This is the same connection as the workspace's Google account (`docs/api/google-account.md`): the flow builder's Sheets, Docs, Forms and Meet steps use it too, each with its own
permission. An account connected for Sheets only reads as `disconnected` here until the calendar permission is added (the Connect button then asks for the calendar and keeps the rest).

**What is asked of Google:** `openid`, `email`, `calendar.events` (write events, Meet), `calendar.freebusy` and
`calendar.calendarlist.readonly` for the calendar capability; the other capabilities are asked only when an admin ticks them on the Google account page. Reference asked for
Calendar, Sheets, Docs, Drive and Forms in one consent. The consent URL carries `access_type=offline` and `prompt=consent`, so Google issues a refresh token on every consent. A consent with
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
`GOOGLE_HTTP_TIMEOUT_MS` (8000), `GOOGLE_BUSY_CACHE_SECONDS` (30), `GOOGLE_BUSY_BACKOFF_SECONDS` (20), and the retry policy `GOOGLE_RETRIES` (2), `GOOGLE_RETRY_BASE_MS` (300), `GOOGLE_RETRY_AFTER_CAP_SECONDS` (5): a 429, 5xx, timeout or network error is repeated with random jitter (never the busy-time lookup a visitor waits on, never the one-time code exchange); a `Retry-After` beyond the cap is not slept on, it is handed to the outbox.

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
disconnected` in the same transaction as the write. Reference also checked the plan feature `integration_google_calendar` on the callback;
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
  nothing and does not throw; the bookings made in that time get their events from the **back-fill** after the next connect (below).

### Busy time

`freeBusy` feeds the slot engine (it blocks every seat, buffers included), on the staff, public and flow paths alike. Answers are cached
`GOOGLE_BUSY_CACHE_SECONDS` per workspace, calendar and window, and the cache for a workspace is dropped when this process writes or
deletes an event of that workspace. A Google outage (any failure, a calendar Google cannot find, a timeout) means **no busy data**: the
slots are offered as if there were no calendar, a warning is logged, and bookings are not blocked. After a failure the next calls for
that workspace answer "no busy data" at once for `GOOGLE_BUSY_BACKOFF_SECONDS`, so a dead Google costs one timeout, not one per request.
A booking type that names a calendar id reads that calendar; otherwise the workspace's chosen one.

A group type (capacity above one) is read with `ignoreOwnEvents`: busy blocks that are exactly one of this platform's own events are
removed (the events carry `crmManaged`), so the first booking's event does not close the slot for the other seats. For a one-to-one type
nothing is removed, which keeps Reference's behaviour that a booking of one service blocks the same time for another service through the
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

## Outlook / Microsoft 365 calendar (BL-035)

A second provider behind the same calendar port. A workspace connects one Microsoft account (work, school or personal) the same way it connects Google; the
platform operator registers the Entra app once for everyone ([runbook](../runbooks/microsoft-calendar-setup.md): this is the part only the owner can do, and
**nothing here was run against a real Microsoft tenant**). Nothing in the booking code knows a provider: it talks to the port, which is fronted by
`MultiCalendarAdapter`.

**Two providers, one event.** Busy time is the UNION of every connected calendar (an Outlook meeting closes a slot even when bookings go to Google). A booking's
event is written to exactly ONE provider, the workspace's **write provider**: the admin's explicit choice while that provider is usable, else Google when usable
(what every workspace had before), else Microsoft, else none. A calendar id a booking type names belongs to the write provider; the other provider is read from
its own chosen calendar. One provider failing leaves the other's busy time in force; only when every source fails does the slot lookup offer slots without
calendar data (and log it). Each appointment remembers the provider that holds its event (`appointments.calendar_provider`; empty with an event id means Google),
so a later change or delete goes to the same calendar. When the write provider changes, the next change to a booking (or the back-fill) removes the event from
the previous provider (best effort: that grant may be gone) and writes a fresh one in the new.

### Routes (`/v2`)

| Route                                                  | Capability                    | Notes                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /appointments/calendar/overview`                  | `record.appointments.read`    | `{ writeProvider, preferredProvider, providers: [{ provider, status, account, calendarId, calendarName, connectedAt, lastErrorCode, active }], backfillPending }`; `status` is `unavailable`, `disconnected`, `connected` or `needs_reconnect`                                           |
| `PUT /appointments/calendar/provider`                  | `record.booking-types.update` | `{ provider: "google" \| "microsoft" \| null }` (null = automatic). `409 APPT_CALENDAR_NOT_CONNECTED` for a provider that is not usable. Audited (`appointment_calendar_preference`), event `appointment_calendar.provider_selected`                                                     |
| `POST /appointments/calendar/backfill`                 | `record.booking-types.update` | queues the back-fill now: `{ queued, pending }`; `queued: false` when no calendar is connected                                                                                                                                                                                           |
| `POST /appointments/calendar/microsoft/start`          | `record.booking-types.update` | `{ returnTo? }`; 200 `{ url, expiresInSeconds }`: Microsoft's consent URL with a signed state (10 minutes, bound to the workspace and the admin). `422 APPT_CALENDAR_NOT_CONFIGURED` without the platform app                                                                            |
| `GET /public/appointments/calendar/microsoft/callback` | none (the signed `state`)     | Microsoft's redirect. Verifies the state and answers **302** to `<WEB_APP_URL><returnTo>?outlook=confirm&ticket=...`, or `?outlook=denied`, `failed`, `expired`, `not_configured`. **It exchanges nothing**                                                                              |
| `POST /appointments/calendar/microsoft/confirm`        | `record.booking-types.update` | `{ ticket }`: only the admin who pressed Connect, in that workspace (`403 APPT_CALENDAR_CONFIRM_NOT_YOURS`); exchanges the code and stores the grant: `{ outcome: connected or missing_scope, returnTo }`. `410 APPT_CALENDAR_CONFIRM_INVALID` for an expired, malformed or spent ticket |
| `GET /appointments/calendar/microsoft/calendars`       | `record.booking-types.update` | the calendars the account can edit, the default first. `409 APPT_CALENDAR_NOT_CONNECTED`, `502 APPT_CALENDAR_PROVIDER_FAILED`                                                                                                                                                            |
| `PUT /appointments/calendar/microsoft/calendar`        | `record.booking-types.update` | `{ calendarId }`, one of the listed ids (else `422`, path `calendarId`); returns the provider's card                                                                                                                                                                                     |
| `POST /appointments/calendar/microsoft/disconnect`     | `record.booking-types.update` | deletes the sealed tokens (Microsoft has no way for an app to withdraw a person's consent: they remove it at myaccount.microsoft.com); idempotent; clears a choice that named Microsoft                                                                                                  |

All staff routes also need the plan's appointment booking (`422 PLAN_FEATURE_LOCKED`). Connect, choose, needs-reconnect and disconnect are each audited (module
`appointment_calendar_microsoft`) and emit `appointment_calendar.connected | calendar_selected | needs_reconnect | disconnected` with `provider: "microsoft"` in
the same transaction as the write.

**The confirmation, and why it differs from Google's.** Google's callback exchanges the code and _parks_ the tokens until the admin confirms, withdrawing them at
Google if the wrong person does. Microsoft offers no way to withdraw a token we were given, so Microsoft's callback exchanges nothing: it verifies the signed
state, then seals the code into a ticket (HMAC-signed, five minutes, bound to the workspace and the admin) and sends the browser to the settings page, where the
same signed-in admin presses Confirm. Only then is the code exchanged. A forwarded consent link opens a page that refuses it (`APPT_CALENDAR_CONFIRM_NOT_YOURS`),
and nothing was ever requested from Microsoft for it. A code is good once at Microsoft, so a replayed ticket fails (`APPT_CALENDAR_CONFIRM_INVALID`) and leaves
the connection as it was.

**What is asked of Microsoft** (delegated; nothing about mail, files or contacts): `openid`, `email`, `offline_access`, `User.Read`, `Calendars.ReadWrite`. A
grant that lacks `Calendars.ReadWrite`, or comes back with no refresh token, stores nothing (`outcome: missing_scope`).

**Console and environment.** The platform operator's group `microsoftCalendar` (`GET|PATCH /platform/settings/groups/microsoftCalendar`): `enabled` (default on),
`clientId`, `tenant` (`common` by default), `redirectUri` (optional override) and the write-only secret `clientSecret` (sealed, never returned; `extra.redirectUri`
is the address to register at Microsoft; default `<APP_URL>/v2/public/appointments/calendar/microsoft/callback`). A field left empty falls back to
`MICROSOFT_CALENDAR_CLIENT_ID`, `_CLIENT_SECRET`, `_TENANT`, `_REDIRECT_URI`. Adapter tuning (defaults are Microsoft's own addresses; they exist so tests can aim
at a stand-in): `MICROSOFT_CALENDAR_LOGIN_URL`, `_GRAPH_URL`, `_HTTP_TIMEOUT_MS` (8000), `_RETRIES` (2), `_RETRY_BASE_MS` (300), `_RETRY_AFTER_CAP_SECONDS` (5),
`_BUSY_CACHE_SECONDS` (30), `_BUSY_BACKOFF_SECONDS` (20).

### Storage

`appointment_microsoft_connections` (migration `20261217090000`): one row per workspace, forced RLS, composite FK to the admin who connected, the same shape as
the Google row, with the refresh and the cached access token sealed with the credentials key (key rotation applies). Microsoft **rotates** refresh tokens: a
refresh returns a new one, which replaces the stored one in the same statement (guarded on the token that was used, so a refresh that loses a race to another
process writes nothing; both are valid at Microsoft). `appointment_calendar_preferences`: the admin's choice of write provider (no row = automatic).
`appointments.calendar_provider`: which provider holds the event.

### Events

- Graph does not let a client choose an event id, so a create carries `transactionId` (the appointment uuid), Graph's own key for a repeated POST; a create that
  still meets a conflict finds the event by the private property written on it (`crmAppointment`) and updates that one. Update, delete and read address an event
  by its id alone (unique in the mailbox, whichever calendar holds it); an event somebody deleted in Outlook is created again by the next change.
- Written: subject (the booking type's name), body, location, start and end (UTC), the customer as a required attendee (Outlook sends the invitation), reminder
  on, shown as busy, and two private properties (`crmManaged`, `crmAppointment`). Cancel and decline delete the event (Outlook sends the cancellation to the
  guest); a 404 counts as deleted.
- A virtual type (or `createMeet`) asks for a **Teams** meeting (work or school accounts) and stores the join link as `meetUrl`. A refusal of the room (a
  personal account has none) is retried without it: the booking keeps its event and has no link.
- A type's own calendar override (`calendar.calendarId`) is a Google calendar's id and is not used for Outlook: events go to the calendar the admin chose on the
  Outlook card.

### Busy time

The `calendarView` of the chosen calendar over the window (recurring meetings are already expanded): `showAs` busy, tentative, out of office or unknown block;
free and working elsewhere do not, and cancelled meetings do not. Cached `MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS` per workspace, calendar and window; a failure
means no busy data from this calendar and a short back-off. A group type (capacity above one) removes this platform's own events (found by `crmManaged`) from the
busy time, as for Google.

### Tokens and refusals

Refresh within a minute of expiry, concurrent refreshes in one process coalesced; a 401 from Graph refreshes once and repeats the call. **`invalid_grant`**
(revoked, 90 days unused, password changed, conditional access) marks the connection `needs_reconnect` once, audited, with an outbox event; the card asks for a
new consent and nothing is read or written until then. `invalid_client` (the platform's secret is wrong or expired) is not the workspace's fault and does not
touch its connection. Account-level failures (throttling, access denied, outage) show on the card as `lastErrorCode` until the next success.

### Not built (recorded)

- The hourly **drift check** (TW-GACC-011) reads Google events only: an Outlook event edited in Outlook is not reported as drifted, and push/accept do not apply to it (BL-200).
- A per-booking-type Outlook calendar; Teams links for personal accounts.
- Everything above is verified against a local stand-in written from Microsoft's documentation (`test/e2e/appointments-booking/fake-microsoft.ts`), never against Microsoft itself.

## Back-fill after a reconnect (BL-035)

A booking made while no calendar was connected (or while the grant needed reconnecting) has no event, and an event is lost with an account that was replaced.
After `appointment_calendar.connected` (first connect, reconnect, another account) or `appointment_calendar.provider_selected`, a worker job writes the missing events:

- **Which bookings:** `confirmed`, not yet ended, starting within **90 days**, whose event is not in the calendar bookings go to now (none, or held by the other provider). Nothing older, nothing further out, nothing pending or cancelled is touched.
- **How:** it only calls the same writer a live booking change calls, so a back-filled event is the event a live one would be. It is **idempotent**: a booking that already has its event in the right calendar is not a candidate; one being written by its own outbox event at the same moment meets the same idempotent write; the booking is read again at the moment of writing, so one cancelled meanwhile is deleted or skipped, never written.
- **Bounded:** at most 200 bookings per pass, 50 per page, a 120 ms pause between writes, in start order; a pass that stops at its limit queues the next from where it stopped, 30 seconds later. One Redis lock per workspace.
- **Failure:** a calendar that cannot be asked (outage, throttling, a grant that just died) stops the pass and throws, so the queue retries with backoff (4 attempts, 60 s base); what was written stays written. One booking the calendar refuses as bad or forbidden is counted and the pass moves on; five refused in a row end the pass (the refusal is then the account's, not the booking's).
- **Trail:** one audit row (`appointment_calendar_backfill`, record = the workspace) and one event `appointment_calendar.backfilled` (`provider`, `written`, `failed`, `moreWaiting`; counts only, never a name or a link) per pass that did something.
- **By hand:** `POST /appointments/calendar/backfill` queues the same job; `GET /appointments/calendar/overview` reports `backfillPending`.

## iCal calendars: a read-only busy source, and your bookings as a subscription (BL-035)

Two directions, both through ICS (RFC 5545). Neither needs an OAuth client or the platform operator.

### IN: other calendars as busy time

A workspace subscribes to a calendar it cannot connect with a sign-in (Apple, Fastmail, a school or club timetable, a Google or Outlook calendar published as a secret address). The feed is **read-only and only ever contributes busy time**: no event of it is imported, shown to anyone,
stored (beyond when the person is busy) or sent anywhere. The slot engine reads the stored intervals from the database in one indexed query, so a slot lookup never waits on someone else's server.

| Route                                               | Capability                    | Notes                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /appointments/calendar/ics-feeds`              | `record.booking-types.read`   | `{ data: [{ id, name, host, isActive, blockAllDay, status, errorCode, lastFetchedAt, lastSuccessAt, calendarName, eventCount, busyCount, warnings, rowVersion, createdAt }] }`. **Never the address**: only its host                                                                                                                            |
| `POST /appointments/calendar/ics-feeds`             | `record.booking-types.update` | _idempotent_; `{ name, url, blockAllDay? }`. The address (`https://`, `http://`, `webcal://`) is **read once before anything is saved**. `422 APPT_ICS_FEED_INVALID` (not an address we read; credentials in it), `422 APPT_ICS_FEED_UNREADABLE` (details `url` with the reason), `409 APPT_ICS_FEED_DUPLICATE`, `422 APPT_ICS_FEED_LIMIT` (10) |
| `PATCH /appointments/calendar/ics-feeds/:id`        | `record.booking-types.update` | `{ name?, isActive?, blockAllDay?, rowVersion }` (`409 ROW_VERSION_CONFLICT`); resuming or changing the all-day rule reads the feed again at once                                                                                                                                                                                               |
| `POST /appointments/calendar/ics-feeds/:id/refresh` | `record.booking-types.update` | reads now; a feed read within the last 30 seconds is left alone                                                                                                                                                                                                                                                                                 |
| `DELETE /appointments/calendar/ics-feeds/:id`       | `record.booking-types.update` | 204; the slots it was closing are free again at once                                                                                                                                                                                                                                                                                            |

The reason codes of an unreadable feed (`errorCode`, and the detail of `APPT_ICS_FEED_UNREADABLE`): `unreachable`, `timeout`, `not_found`, `forbidden`, `server_error`, `redirect_loop`, `not_a_calendar`, `too_large`, `blocked_address`.

**The address is a secret.** Published-calendar addresses carry a token, so it is sealed with the credentials key (`url_enc`), never returned, never in an audit row, an outbox event or a log line (only the host and the reason code are). **The server is not a way into its own network:** every fetch goes through the shared guarded client, which
refuses loopback, private, link-local and CGNAT destinations at the socket's own DNS lookup (no gap for DNS rebinding), caps the answer at 5 MB, and never follows a redirect by itself; the fetcher follows at most four by hand and checks each hop as a fresh request (iCloud's published calendars redirect to another host). `ICS_FEED_ALLOW_PRIVATE_ADDRESSES` exists for tests only and is off.

**How a feed is read.** The worker's scheduler (every minute) claims the feeds that are due and queues one job each (queue `calendar-ics-refresh`, a Redis lock per feed); a healthy feed is read every 15 minutes with a conditional GET (`ETag`, `Last-Modified`), a failing one at 15 minutes doubling up to 6 hours, and the busy intervals of the last good read stay while it fails. A feed
that has not been read successfully for **7 days** contributes nothing. The status, counts and tags of a read are monitoring columns: they do not bump `row_version`, so an admin editing a feed never gets a 409 because of a refresh.

**What counts as busy** (`ics-feed-parser.ts`, pure and unit-tested): a VEVENT that is not `STATUS:CANCELLED` and not `TRANSP:TRANSPARENT`; all-day events block their whole local day unless the feed is set to ignore them; a point in time with no end blocks nothing. Recurring events are expanded for the window (today minus a day to 180 days ahead):
`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` with `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (with ordinals), `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`, `WKST`, plus `RDATE`, `EXDATE` and `RECURRENCE-ID` overrides; the expansion is done on the wall clock of the event's zone, so a 9:00 meeting stays at 9:00 across a daylight-saving change.
Time zones: an IANA name as is, the Windows names Outlook writes mapped, floating times and unknown zones read in the feed's `X-WR-TIMEZONE` or the workspace's zone. **Anything it cannot interpret is counted, not guessed away:** an unknown zone (`warnings.unknownZone`), a rule it does not support (HOURLY, BYYEARDAY, BYWEEKNO ...: only the first occurrence is used, `warnings.unsupportedRule`), more than 5,000
blocks (`warnings.truncated`); the settings card shows all three. A body that is not an iCalendar (an HTML sign-in page) is `not_a_calendar`, never read as "no events".

**Limits, recorded.** A feed of the calendar that bookings are written to counts a multi-seat service's own events as busy (a feed has no way to mark them as ours) and a cancelled booking's slot stays blocked until the next read: do not subscribe to the booking calendar. Basic-auth feeds, CalDAV and two-way sync are not built (BL-202).

Storage (migration `20261218090000`): `calendar_ics_feeds` (forced RLS, composite FK to the admin, unique per address, monitoring trigger), `calendar_ics_busy` (the stored intervals, replaced as a whole by each good read, cascade on delete). Audit module `calendar_ics_feed`; outbox `calendar_ics_feed.created | updated | deleted` (a uuid, never the address).

### OUT: my bookings in my calendar app

| Route                                         | Capability                                | Notes                                                                                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /appointments/calendar/bookings-feed`    | `record.appointments.read`                | `{ url, createdAt, lastUsedAt }` of the signed-in person's link (`url: null` until they make one)                                                                                                                                             |
| `POST /appointments/calendar/bookings-feed`   | `record.appointments.read`                | makes the link, or replaces it with a new one (the old stops working at once); audit + outbox `appointment_feed.created \| rotated`                                                                                                           |
| `DELETE /appointments/calendar/bookings-feed` | `record.appointments.read`                | 204; stops the feed; audit + outbox `appointment_feed.revoked`                                                                                                                                                                                |
| `GET /public/appointments/feed/<token>.ics`   | none (the 43-character token in the path) | `text/calendar`. 404 for an unknown, revoked or malformed link (the same answer, no query for a malformed one). Throttled per IP and per link. `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` |

The token is 256 random bits; only its SHA-256 is a lookup key and an encrypted copy lets the person copy the link again. **What the feed shows is decided when it is read**, from the person's CURRENT record scope over appointments (own, team or all) and their current status: a person who loses the capability or is deactivated sees an empty feed (or none), with the same link.
Pending and confirmed bookings from 30 days ago to 180 days ahead, at most 2,000, each with the booking's title, time, place and status (`TENTATIVE` for a pending one) and **nothing else**: no phone, e-mail, notes, answers or manage link, because calendar apps cache the feed on their own servers. The token never appears in an audit row, an event or a log line.

## Tools for agents and chatbots (BL-035): the contract, not yet bound

An AI agent or a chatbot that can be given tools books the way a person does: see what is offered, pick a time, confirm, change it later. **The contract is written** (`packages/contracts/src/appointments/booking-tools.ts`: four tool definitions with JSON Schema and Zod arguments and results, a `parseBookingToolCall` that validates what a model sent, the stable refusal codes, and the rules below), and **nothing is bound to it yet**, because the customer-facing AI has nothing to bind it to:

- **AI Agent Studio** (`ai-agents-training`) stores assistants and their training sources and the chat widget (`chatbot-widget`, `WidgetAiReplyService`) answers with `AiChatPort.complete`: **one prompt, one text answer**, no tool definitions, no tool-call loop.
- **The flow runtime** has no tool registry. Its Book appointment node (below, "For the flow-runtime domain") already books through chat with fixed steps, and its AI step is a single completion.
- The only tool-calling loop in the repository is the **staff** AI CRM Copilot (`ai-copilot-lead-finder`: `AiCrmProviderPort.runTurn`, `AiCrmToolkitService`, confirm-before-act for writes). It acts as the signed-in staff member, not as a customer's assistant, belongs to another domain's zone, and is a different audience; adding appointment tools there is a follow-up (BL-201), not part of this change.

Building a tool-calling loop for the customer-facing AI is a design of its own (provider support for tools, the confirmation turn, metering, safety review), so it was not started here.

| Tool                     | Kind  | Maps to (the existing service)                                                                                                 |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `list_services`          | read  | `BookingOffersService.offer(orgId)`: the active types, their questions, what is due to book, and the plan gate                 |
| `check_availability`     | read  | `BookingOffersService.days` / `.times`, or the slot engine over a date window: at most 9 times, soonest first, at most 14 days |
| `book_appointment`       | write | `BookingOffersService.reserve` then `.book(orgId, input)`: actor `bot`, source `chat`, the same engine and guards              |
| `reschedule_appointment` | write | the customer's own move (`PublicBookingService.reschedule` rules): an offered slot, not started, pending or confirmed          |

**Rules a binding must keep** (they are in the contract's header, and `parseBookingToolCall` enforces the checkable ones):

1. **One booking path.** The tools call the services above; there is no second way to book. The double-booking guarantee, the plan cap, `maxPerDay`, buffers and the calendar's busy time (every connected calendar and iCal feed) apply exactly as for a person.
2. **A write needs the customer's explicit yes** in the conversation (`confirmed: true`). The binding stops at the call, shows the service, the time in the customer's zone and any amount due, and runs only after a clear confirmation turn. `parseBookingToolCall` refuses a write with `confirmed` not true as `not_confirmed`.
3. **Identity comes from the conversation, never from the model.** A reschedule takes no phone, e-mail or contact id: the appointment must belong to the conversation's contact, else `not_found` (never `forbidden`: no oracle for other people's bookings). A booking made through the tool is attached to the conversation's contact; a name, phone or e-mail is accepted only for a visitor with no contact yet, through the same find-or-create the booking page uses.
4. **Consent and privacy.** Booking records no marketing consent and grants none. The confirmation and reminder messages it triggers are **service** messages (the ConsentGate asks for the `service_messaging` purpose: a contact who sent STOP still gets them, one who withdrew the service purpose does not). An after-visit follow-up is asked as `marketing_messaging`, so it needs consent where the workspace requires it and is stopped by an opt-out or the do-not-call list. Results carry no phone, e-mail, notes or answers of anyone; the manage link is returned only for the same customer, in the same thread. The schemas drop anything beyond the contract.
5. **Idempotent and bounded.** A write carries an idempotency key (`<conversation id>:<tool call id>`), so a retried call books once; a conversation may do at most 3 booking writes; `check_availability` returns at most 9 times.
6. **Refusals are results.** `{ ok: false, code, message }` with the codes `unavailable`, `unknown_service`, `slot_unavailable`, `slot_taken`, `answers_invalid`, `not_found`, `not_changeable`, `too_many_writes`, `not_confirmed`, so the model can say something true instead of the turn failing.

## Ports (what other domains plug in)

| Port (token)                                     | File                                                                      | Stub adapter                         | Who binds the real one                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `CalendarSyncPort` (`APPOINTMENT_CALENDAR`)      | `apps/api/src/infra/providers/appointments-booking/calendar-sync.port.ts` | `NoCalendarSync` (not connected)     | bound here: `MultiCalendarAdapter` over `GoogleCalendarAdapter` and `MicrosoftCalendarAdapter` |
| `AppointmentMessenger` (`APPOINTMENT_MESSENGER`) | `.../appointment-messenger.port.ts`                                       | `NoAppointmentMessenger` (`skipped`) | bound in the worker process: `ChannelAppointmentMessenger` (below)                             |

Override the token in a module (`{ provide: APPOINTMENT_MESSENGER, useClass: ... }`); the stubs are what a deployment has until then.

**The messenger (BL-283).** `ChannelAppointmentMessenger` (`modules/appointments-booking/channel-appointment-messenger.ts`, provided by
`AppointmentsBookingWorkerModule` only) delivers through the stack the rest of the product already sends with, not a transport of its own:

- **WhatsApp** through the conversation core (`enqueueOutbound`, source `bot`): the message lands in the contact's thread and the dispatcher
  checks the connection, the plan's cap, the wallet and the emergency halt again at send time. An approved **template** goes on the Cloud API
  number it was approved for (numbered variables filled name, service, date, time, place, join link, manage link; a missing value becomes `-`;
  a template with a media header, a variable in its header or a link button, or named variables is `template_unavailable`). **Free text** goes
  only inside the 24 hour window on the Cloud API, anywhere on a QR number; otherwise WhatsApp is skipped as `template_required` and the rule
  falls to its next channel. The idempotency key becomes the message's `clientMessageId`, so a retry is the first message.
- **SMS** and **email** through `EngineSenderRegistry` (the engines the broadcast screens use), from the primary connected SMS number and the
  oldest connected **shared** mailbox (never a personal mailbox). No key at the engines, so the caller never retries an interrupted delivery.
- **Before delivering**, in order: the address exists (`no_contact_point`); for a reminder or follow-up the **quiet hours** (`SendWindowService`,
  kind `message`): a hold becomes `held` with the instant they end, never a refusal, except a reminder they would push to within five minutes of
  the start or past it, which is skipped (`quiet_hours_too_late`); then the **ConsentGate** (`service_messaging` for a booking notice and a
  reminder, `marketing_messaging` for a follow-up, the template's own category for a WhatsApp template): withdrawn consent, the do-not-call
  list, a minor and a legal hold are skipped with their own reason. A confirmation or cancellation is not held by quiet hours.
- A result is `sent`, `held` (+ `holdUntil`), `skipped` or `failed`, each with a stable reason code. The text and the address never reach a result,
  a run or the timeline; a provider's own error sentence goes to the log's error field only.
  The calendar port is served by `MultiCalendarAdapter` over the Google and Outlook adapters (`NoCalendarSync` stays as the reference "nothing connected" behaviour). The Sheets
  append is not built (`blocked`: it is the Sheets half of TW-APPT-012 and 029, and its scope is not requested).

**For the flow-runtime domain** (the "Book appointment" node, TW-APPT-034) call `BookingOffersService` (exported from the barrel, no HTTP):
`offer(orgId)` (active types + the gate: `feature_off` / `plan_limit`), `days(orgId, typeId, offset)` and `times(orgId, typeId, date, offset)`
(nine to a page), `reserve(orgId, typeId, startsAt, sessionRef)` (a ten-minute soft lock), `book(orgId, input)` (the same engine and guard,
as actor `bot`, source `chat`). Subscribe to `appointment.booked` for the `appointment_booked` trigger and the notification toggle.
**For the payments domain**: consume `appointment.payment_due`, call `AppointmentsService.recordPayment` when settled.

## Calendar drift (TW-GACC-011)

`calendar.sync` on an appointment is `{ state: in_sync | drifted | null, reason, detectedAt, googleStartsAt, googleEndsAt, checkedAt }`. A worker reconcile (queue `calendar-reconcile`, one workspace per job, Redis lock, about hourly, only confirmed
appointments with an event in the next 60 days, each read about once an hour) compares the Google event with what we last wrote and records `drifted` with one of `event_deleted`, `event_missing`, `time_changed`, `attendees_changed`. It never
changes the appointment; the first detection writes an audit row and the outbox event `appointment.calendar_drifted` (one in-app notification, type `appointment_calendar_drift`, to the host or the person who booked). Our own writes and a guest
answering are not drift. Plan section 8: [google-workspace-build.md](../threadwise-port/plan/google-workspace-build.md).
