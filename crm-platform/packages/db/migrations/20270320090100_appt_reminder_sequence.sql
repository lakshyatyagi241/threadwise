-- Appointment reminder SEQUENCES (BL-421): a booking type's reminders become an ordered sequence of steps shown as a timeline.
--
-- Why: a rule was "N minutes before or after", with one text. A booking type now has a sequence of steps with a meaning: the
-- confirmation (sent when the booking is made), the 24 hour, 2 hour and 15 minute reminders, the after-visit message, the no-show
-- message and a rebook (recall) message. Each step has its own channel order with automatic fallback, its own message (an email message
-- of the library and/or an approved WhatsApp template), and each delivery records which channel was used or skipped and why.
--
-- Expand-only, so the running version keeps working while this applies: every new column is nullable or has a default, the two
-- uniqueness keys stay as they are (an event step takes the fixed offset 0 for the confirmation and 1 for the no-show message, which
-- no timed step uses, so the key still tells every step apart), and the CHECK constraints are widened under their own names.

-- --- the step ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE booking_reminders
  -- Which step of the sequence this is. Null = a rule saved before steps existed; it is read as the step its kind and offset suggest.
  ADD COLUMN step_kind text,
  -- The reminder carries Confirm / Reschedule / Cancel quick-reply buttons (WhatsApp).
  ADD COLUMN buttons_enabled boolean NOT NULL DEFAULT false,
  -- Skip this step when the customer has already confirmed (the 2 hour reminder).
  ADD COLUMN skip_if_confirmed boolean NOT NULL DEFAULT false,
  -- Use the next channel when the message was not delivered after this many minutes. Null = off.
  ADD COLUMN undelivered_fallback_minutes integer,
  -- The email message of the appointment library this step sends (read when it is sent, so editing the message changes what goes out).
  ADD COLUMN library_template_id bigint,
  ADD CONSTRAINT fk_booking_reminders_library_template_id FOREIGN KEY (org_id, library_template_id)
    REFERENCES appointment_message_templates (org_id, id) ON DELETE SET NULL (library_template_id),
  ADD CONSTRAINT chk_booking_reminders_undelivered CHECK (
    undelivered_fallback_minutes IS NULL OR undelivered_fallback_minutes BETWEEN 5 AND 720),
  ADD CONSTRAINT chk_booking_reminders_step_kind CHECK (
    step_kind IS NULL
    OR (kind = 'before' AND step_kind IN ('reminder_24h', 'reminder_2h', 'reminder_15m', 'reminder'))
    OR (kind = 'after' AND step_kind IN ('after_visit', 'rebook'))
    OR (kind = 'event' AND step_kind IN ('confirmation', 'no_show')));

CREATE INDEX idx_booking_reminders_library_template_id ON booking_reminders (org_id, library_template_id);

-- An event step is sent when something happens, so it has no time: 'event' is a third kind. A rebook can wait up to a year.
ALTER TABLE booking_reminders DROP CONSTRAINT chk_booking_reminders_kind;
ALTER TABLE booking_reminders
  ADD CONSTRAINT chk_booking_reminders_kind CHECK (kind IN ('before', 'after', 'event'));
ALTER TABLE booking_reminders DROP CONSTRAINT chk_booking_reminders_offset;
ALTER TABLE booking_reminders
  ADD CONSTRAINT chk_booking_reminders_offset CHECK (
    offset_minutes BETWEEN 0 AND 525600 AND offset_index BETWEEN 0 AND 15);

-- Rules that exist today get the step their kind and offset suggest.
SELECT set_config('app.privileged', 'on', true);
UPDATE booking_reminders
   SET step_kind = CASE
     WHEN kind = 'after' THEN 'after_visit'
     WHEN offset_minutes = 1440 THEN 'reminder_24h'
     WHEN offset_minutes = 120 THEN 'reminder_2h'
     WHEN offset_minutes = 15 THEN 'reminder_15m'
     ELSE 'reminder' END
 WHERE step_kind IS NULL AND kind IN ('before', 'after');

-- --- the message library gets the two new kinds ----------------------------------------------------------------------------------

ALTER TABLE appointment_message_templates DROP CONSTRAINT chk_appointment_message_templates_kind;
ALTER TABLE appointment_message_templates
  ADD CONSTRAINT chk_appointment_message_templates_kind CHECK (
    kind IN ('confirmation', 'reminder', 'reschedule', 'cancellation', 'follow_up', 'no_show', 'rebook'));

-- --- the delivery record ----------------------------------------------------------------------------------------------------------

ALTER TABLE appointment_reminder_runs
  ADD COLUMN step_kind text,
  -- Every channel the step tried, in order: [{"channel":"whatsapp","status":"skipped","reason":"template_unavailable"},
  -- {"channel":"email","status":"sent","reason":null}]. Codes only: never an address, a number or a message.
  ADD COLUMN attempt_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The thread message of a WhatsApp send (its status tells whether it was delivered or failed afterwards).
  ADD COLUMN message_ref uuid,
  -- What became of the message after it was handed over: unknown (nothing reported yet or not tracked), delivered, failed, or
  -- undelivered (the step's "not delivered after N minutes" fallback went to the next channel).
  ADD COLUMN delivery text NOT NULL DEFAULT 'unknown',
  ADD COLUMN delivered_at timestamptz,
  -- When the sweep looks at the message again; null = nothing to watch.
  ADD COLUMN delivery_check_at timestamptz,
  ADD CONSTRAINT chk_appointment_reminder_runs_delivery CHECK (
    delivery IN ('unknown', 'delivered', 'failed', 'undelivered')),
  ADD CONSTRAINT chk_appointment_reminder_runs_step_kind CHECK (
    step_kind IS NULL OR step_kind IN (
      'confirmation', 'reminder_24h', 'reminder_2h', 'reminder_15m', 'reminder', 'after_visit', 'no_show', 'rebook'));

ALTER TABLE appointment_reminder_runs DROP CONSTRAINT chk_appointment_reminder_runs_kind;
ALTER TABLE appointment_reminder_runs
  ADD CONSTRAINT chk_appointment_reminder_runs_kind CHECK (kind IN ('before', 'after', 'event'));

-- The delivery sweep reads what is being watched across workspaces (privileged), soonest first.
CREATE INDEX idx_appointment_reminder_runs_delivery_watch
  ON appointment_reminder_runs (delivery_check_at) WHERE delivery_check_at IS NOT NULL;

-- The step of a run that was already written follows its rule.
UPDATE appointment_reminder_runs r
   SET step_kind = b.step_kind
  FROM booking_reminders b
 WHERE b.org_id = r.org_id AND b.id = r.reminder_id AND r.step_kind IS NULL AND b.step_kind IS NOT NULL;

-- --- the customer's own confirmation ------------------------------------------------------------------------------------------------

-- Set when the customer taps Confirm on a reminder (or replies with the confirm button). A booking can be `confirmed` by the business
-- long before the customer says "yes, I am coming"; this is the second fact, used to skip the 2 hour reminder and in the reports.
ALTER TABLE appointments ADD COLUMN customer_confirmed_at timestamptz;
