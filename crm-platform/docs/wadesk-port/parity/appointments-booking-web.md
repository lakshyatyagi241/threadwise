# Parity evidence: appointments and bookings, web screens (WD-APPT-002..015, 022, 024..026; EXT-APPT-01..04, 06)

The staff screens (`/appointments`, `/appointments/types`, the booking type editor, `/appointments/settings`), the contact panel and the
public booking pages (`/book/<workspace>/<service>`, `/b/manage/<token>`), written in `apps/web/src/features/appointments`. API side:
[the inventory](../inventory/appointments-booking.md) and `docs/api/appointments-booking.md`. Reference: WaDesk at `127.0.0.1:8000`
(workspace user `user@wadesk.test`), read only.

## How this was checked, and its limits

- Reference side: the four staff screens were opened and compared (Your bookings, Booking types, the five-step wizard, Settings). The
  reference workspace has no bookings and no booking types, and Google Calendar is not connected, so only the empty states and the
  forms were seen. Its public manage pages were not opened (no booking exists there to hold a token); they were read from source.
- Our side: every flow was run in the browser against the real API on `:3100` (create a type in the wizard, book it from the public
  page, see it in the list and the drawer, reschedule it as staff, cancel it from the manage link, pause, duplicate and delete a type,
  open the contact page), and against the in-memory development stand-in for the states a real server does not produce on demand.
  Light and dark, Arabic (RTL) and 390 px were checked on the staff list, calendar and types, the editor, settings and the public pages.
- `wadesk-playwright-parity` (the twin-run skill) was not run: the reference has no data to drive the same scenarios on both sides.
- Unit tests: 273 in `src/features/appointments` (time zones and DST, slot grouping, the slot engine, week grid layout, filters,
  availability model, booking form, money, ICS, the API wire mapping, the public relay's path allowlist, message parity).

## Same as WaDesk

Page title "Your bookings", breadcrumb Integrations / Appointments, the three header actions, the Upcoming and Past lists with the
empty state ("No upcoming bookings ... drop a Book appointment node into any flow"), the five-step wizard (Service, Timing,
Availability, Pricing, Messaging) with every field and limit of `BookingTypeController::upsert`, the live summary and slot preview
rail, the booking types list with Active and Paused, the delete confirmation copy, and the manage page (view, reschedule, cancel with
confirm, "Your booking has been cancelled.").

## Intended differences

| Area                          | Difference                                                                                                                                                                                                  | Why                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Look                          | Contact Hub look (header band, compact toolbar, bordered card with a pinned footer) instead of WaDesk's serif heading, left rail and cards                                                                  | Owner's style direction (product-extensions item 1 and 2)                                                                                                         |
| Bookings                      | Tabs with counts, status, type and search filters, a week and a month calendar, a detail drawer (answers, notes, reminders, manage link, host, payment), confirm, decline, complete, no-show and reschedule | Owner request (EXT-APPT-04); WaDesk shows two tables and a Cancel button                                                                                          |
| Reminders in the drawer       | Derived from the type's offsets and the clock (scheduled, time reached, not sent); the API does not record delivery per reminder                                                                            | The response has no reminder list                                                                                                                                 |
| Price entry                   | Fee, deposit and cancel fees are typed in major units ("150.00")                                                                                                                                            | WaDesk asks for minor units ("15000 = 150.00")                                                                                                                    |
| Editor extras                 | Colour, public link with copy, "Require approval", date overrides on a calendar, multiple intervals per day with copy, select-question choices, a time zone search                                          | Owner request; WaDesk has no UI for overrides or select options                                                                                                   |
| Public booking page           | New (`/book/<workspace>/<service>`): service chooser, month calendar and times in the visitor's time zone with a selector, questions, confirmation with ICS and Google Calendar links and the manage link   | Owner request (EXT-APPT-01); WaDesk books only inside chat. Under `/book`, not `/b`, because `/b/<token>` is WaDesk's Client Brief page                           |
| Manage page                   | Shows Pending as its own state (WaDesk shows Confirmed), times in the visitor's zone first, a calendar picker for rescheduling, add to calendar, no reschedule or cancel once the start has passed          | EXT-APPT-03, 04, 06; WaDesk's day chips and always-on buttons                                                                                                     |
| Settings                      | Not a calendar connection form: calendar status, business hours, time zone, defaults and message templates, kept in this browser's stand-in only                                                            | The API keeps no workspace-level settings (spec decision D-16, owner to confirm). On the real API the screen says it is not available and points to booking types |
| Public link for a paused type | None shown                                                                                                                                                                                                  | A paused type is not offered                                                                                                                                      |

## Blocked or not built (each needs a module that does not exist yet)

- Payment gateway select, deposit collection and WaDesk's payment result page (WD-APPT-027, `platform-payment-gateways`): the editor
  records the amounts and says so; the public page shows prices and states that nothing is charged on it.
- WhatsApp template picker per lifecycle message (WD-APPT-013, `message-templates`): plain text only; `waTemplateId` round-trips.
- Google Calendar connect, calendar list, Meet and Sheets (WD-APPT-028, 029): the editor's calendar fields are disabled while the
  API reports no adapter; the settings card only reports status.
- The flow node "Book appointment" (WD-APPT-034) is a flows feature; the empty state mentions it as WaDesk does.
- A server-side manage-page ICS download exists on the API; the page builds its `.ics` in the browser instead.

## Not verified

- Plan gating (`access_appointment_booking`, monthly cap): the reference workspace has no package, so every flag is on there.
- Concurrent booking of one slot from two browsers against the real API (the stand-in and unit tests cover the lost race).
- The public relay's `no-store` header in a production build (Next overrides `Cache-Control` in development).
- Read-only roles (no `record.appointments.update`): the buttons are hidden by `useAppointmentsCan`, not exercised with a second user.
