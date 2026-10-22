-- Reminder packs and the customer's quick reply (BL-424, BL-426). Expand-only: every new column is nullable or has a default.
--
-- booking_reminders.service_label: the word a step uses INSTEAD of the booking type's name in its messages. A medical practice sets it to
--   "appointment" so a message never names the visit ("your appointment", not "your cardiology review"). Null = the type's own name.
-- booking_reminders.pack_key / pack_version: which reminder pack a step was made from, so the next preview can say "already up to date"
--   or "the pack has changed since you applied it". Null = the owner wrote the step.
-- appointment_reminder_runs.reply_state: the three one-time reply tokens of a step with Confirm / Reschedule / Cancel buttons:
--   {"confirm": {"nonce": "...", "usedAt": null, "outcome": null}, ...}. A nonce is random, the token that goes into the button is the
--   encrypted (authenticated) pair of the run and the nonce, so it cannot be forged, and a tap uses it once. Codes only, no personal data.

ALTER TABLE booking_reminders
  ADD COLUMN service_label text,
  ADD COLUMN pack_key text,
  ADD COLUMN pack_version smallint,
  ADD CONSTRAINT chk_booking_reminders_service_label CHECK (service_label IS NULL OR char_length(service_label) BETWEEN 1 AND 40),
  ADD CONSTRAINT chk_booking_reminders_pack CHECK (
    (pack_key IS NULL AND pack_version IS NULL) OR (pack_key IS NOT NULL AND char_length(pack_key) <= 40 AND pack_version IS NOT NULL));

ALTER TABLE appointment_reminder_runs
  ADD COLUMN reply_state jsonb NOT NULL DEFAULT '{}'::jsonb;
