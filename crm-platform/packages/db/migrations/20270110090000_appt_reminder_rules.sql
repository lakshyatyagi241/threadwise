-- Appointment reminders and follow-ups per booking type (BL-283).
--
-- Why: until now a booking type had only "N minutes before" offsets that shared one message per event, and the customer message port
-- was a stub, so nothing was delivered or recorded. A rule now says WHEN (before the start, or after the end), on WHICH channels (an
-- ordered preference, the first that can deliver wins), WHAT (its own text, or an approved WhatsApp template) and whether it is ON.
-- Every run (one rule for one booking) records its outcome, so the booking and the contact's timeline can say what happened.
--
-- Nothing changes for a workspace until it switches a rule on: a new rule is created OFF. Rules that already exist stay as they are
-- (they were created switched on and keep sending through the type's own "reminder" message, now really delivered).

-- --- the rule --------------------------------------------------------------------------------------------------------------------

ALTER TABLE booking_reminders
  -- before: offset_minutes before the start. after: offset_minutes after the END (the follow-up).
  ADD COLUMN kind text NOT NULL DEFAULT 'before',
  -- Ordered preference. The first channel the contact can be reached on, with a connected sender, wins; the rest are fallbacks.
  ADD COLUMN channels text[] NOT NULL DEFAULT ARRAY['whatsapp', 'sms', 'email']::text[],
  ADD COLUMN subject text,
  -- null = the type's lifecycle message for reminders (before) or the built-in follow-up text (after).
  ADD COLUMN body text,
  -- An approved WhatsApp template: required for WhatsApp outside the 24 hour window; without one WhatsApp is skipped there.
  ADD COLUMN wa_template_id bigint,
  ADD CONSTRAINT chk_booking_reminders_kind CHECK (kind IN ('before', 'after')),
  ADD CONSTRAINT chk_booking_reminders_channels CHECK (
    cardinality(channels) BETWEEN 1 AND 3 AND channels <@ ARRAY['whatsapp', 'sms', 'email']::text[]),
  ADD CONSTRAINT chk_booking_reminders_text CHECK (
    (body IS NULL OR char_length(body) <= 2000) AND (subject IS NULL OR char_length(subject) <= 191)),
  ADD CONSTRAINT fk_booking_reminders_wa_template_id FOREIGN KEY (org_id, wa_template_id)
    REFERENCES wa_templates (org_id, id) ON DELETE SET NULL (wa_template_id);

-- A rule created from now on is OFF until someone switches it on.
ALTER TABLE booking_reminders ALTER COLUMN is_active SET DEFAULT false;

-- 30 minutes before and 30 minutes after are two different rules.
ALTER TABLE booking_reminders DROP CONSTRAINT uq_booking_reminders_booking_type_id_offset_minutes;
ALTER TABLE booking_reminders
  ADD CONSTRAINT uq_booking_reminders_booking_type_id_kind_offset UNIQUE (org_id, booking_type_id, kind, offset_minutes)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_booking_reminders_wa_template_id ON booking_reminders (org_id, wa_template_id);

-- --- the runs --------------------------------------------------------------------------------------------------------------------

-- One row per (booking, rule, arming). `armed_at` is the booking's own `armed_at` when the sweep claimed the run: a reschedule moves
-- the booking's `armed_at`, so the rule is claimed again for the new time while the old row stays as history (cancelled or sent).
-- The unique key is the idempotency: two workers, a retry or a restart can all try to claim the same run and exactly one insert wins.
ALTER TABLE appointment_reminder_runs
  ADD COLUMN kind text NOT NULL DEFAULT 'before',
  ADD COLUMN armed_at timestamptz,
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  -- A stable code (quiet_hours, opted_out, no_sender, ...), never a message, a number or an address.
  ADD COLUMN reason text,
  ADD COLUMN channel text,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Claims written before this change went to a messenger that delivered nothing (the stub answered "skipped"), so that is what they say.
UPDATE appointment_reminder_runs r
   SET armed_at = a.armed_at, status = 'skipped', reason = 'no_channel_adapter', next_attempt_at = r.claimed_at
  FROM appointments a
 WHERE a.org_id = r.org_id AND a.id = r.appointment_id;

ALTER TABLE appointment_reminder_runs
  ALTER COLUMN armed_at SET NOT NULL,
  ADD CONSTRAINT chk_appointment_reminder_runs_kind CHECK (kind IN ('before', 'after')),
  ADD CONSTRAINT chk_appointment_reminder_runs_status CHECK (
    status IN ('pending', 'sending', 'held', 'sent', 'skipped', 'failed', 'cancelled')),
  ADD CONSTRAINT chk_appointment_reminder_runs_channel CHECK (channel IS NULL OR channel IN ('whatsapp', 'sms', 'email'));

ALTER TABLE appointment_reminder_runs DROP CONSTRAINT uq_appointment_reminder_runs;
ALTER TABLE appointment_reminder_runs
  ADD CONSTRAINT uq_appointment_reminder_runs UNIQUE (org_id, appointment_id, kind, offset_minutes, armed_at);

-- The delivery sweep reads what is waiting across workspaces (privileged), oldest first; a finished run never matches.
CREATE INDEX idx_appointment_reminder_runs_waiting
  ON appointment_reminder_runs (next_attempt_at) WHERE status IN ('pending', 'held', 'sending');
