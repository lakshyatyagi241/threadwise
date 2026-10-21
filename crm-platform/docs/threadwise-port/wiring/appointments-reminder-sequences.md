# Wiring: appointment reminder sequences (BL-420 to BL-429)

API [../../api/appointment-reminder-sequences.md](../../api/appointment-reminder-sequences.md). Not a Reference feature: a net addition on top of the reminders of BL-283 (see
[parity/product-extensions.md](../parity/product-extensions.md)). Builds on [appointments-booking.md](appointments-booking.md) (WIRE-APPT-017 the messenger, WIRE-APPT-022..024 the library).

| Piece | Where |
| ----- | ----- |
| Tables / columns | migrations `20270320090000` (SMS removed: `booking_reminders.notice_code`, default channels), `...090100` (`step_kind`, `buttons_enabled`, `skip_if_confirmed`, `undelivered_fallback_minutes`, `library_template_id`; `appointment_reminder_runs.step_kind`, `attempt_log`, `message_ref`, `delivery*`; `appointments.customer_confirmed_at`; `kind = event`; library kinds `no_show`, `rebook`), `...090200` (`service_label`, `pack_key`, `pack_version`; `appointment_reminder_runs.reply_state`) |
| Contracts | `packages/contracts/src/appointments/{booking-type,appointment,channels,reminder-sequence}.ts`; plan keys in `plans-subscriptions-trials/catalogue.ts`; notification types `appointment_cancelled_by_customer`, `appointment_reminder_test` (`notifications-activity-audit`) |
| Rules (pure) | `appointment-reminder.rules.ts` (gate, fallback `settleChannels`, `attemptLogOf`, reasons), `reminder-reply.rules.ts` (token, `decideReply`, reply text) |
| Claim and delivery | `appointment-reminders.repository.ts` (`claimDue`, `claimEvent`, delivery watch), `appointment-reminder-sweep.service.ts`, `appointment-reminder.service.ts` (`work`, `tryChannels`, `fallBack`, `watchDelivery`), `appointment-message.consumer.ts` (event steps: `appointment.booked` / `confirmed` -> confirmation, `appointment.no_show` -> no-show) |
| Messenger | `channel-appointment-messenger.ts` (WhatsApp via `enqueueOutbound` with quick-reply components, email via `EngineSenderRegistry`, `isTest` for the email test); SMS path removed |
| Packs | `reminder-packs.data.ts` (versioned content), `reminder-packs.service.ts`, `appointment-templates.service.ts` (`ensurePackEmail`, `ensurePackWhatsapp`), controller `reminder-sequence.controller.ts` |
| Buttons | `reminder-reply.service.ts` (a `first` listener of `InboundMessageHooks`, worker only), `booking.service.ts` `transition(... via: 'reminder_reply')`, `notifications/appointment-reply-notification.consumer.ts` tells the host |
| Test email | `reminder-test-send.ts` (request in the API process, `ReminderTestSendConsumer` in the worker), the result in the bell |
| Report | `reminder-report.service.ts` |
| Plan gates | `booking-types.service.ts` (on switching a step on), `appointment-reminder.service.ts` (rebook at delivery), `reminder-reply.service.ts` `buttonsAllowed` |
| Tests | `test/unit/appointments-booking/{reminder-packs,reminder-reply,appointment-reminder.rules,channel-appointment-messenger}.spec.ts`, `test/e2e/appointments-booking/{reminder-sequence,appointments-workers,appointment-channels}.e2e.spec.ts`, `test/integration/appointments-booking/appointments-schema.spec.ts` |
| Web | `apps/web/src/features/appointments` (the timeline, pack preview, step editor, report, the drawer's delivery record); help guides `appointments-reminders`, `appointments-reminder-packs`, `appointments-confirm-by-reply` |

Consumers of reminder rows that keep working unchanged: the booking type editor and its Messaging step, the appointment drawer's reminders, the contact timeline
(`appointment_reminder` activity), the audit log (`appointment_reminder_runs`), the lifecycle sweep, the public manage page (the buttons use the same cancel).
