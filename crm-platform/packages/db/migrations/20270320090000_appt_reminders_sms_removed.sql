-- SMS is removed from appointment reminders and messages (owner decision, BL-420).
--
-- Why: an SMS to a customer in India needs a DLT-registered sender and template, and every other country has its own sender-id and
-- opt-in rules, so SMS could not be relied on for a message the customer is waiting for. Appointment messages go out on WhatsApp and
-- email only (voice stays reserved for the Voice bot). SMS for broadcasts and one-time codes is a different product and is not touched.
--
-- This migration is expand-only and loses nothing:
--   * no row is deleted (a rule that only had SMS is kept, with a visible note), no column or value is dropped, and the old CHECK
--     constraints keep accepting 'sms' so history (old runs, old settings) still reads;
--   * a rule that listed SMS among other channels simply loses SMS from its list;
--   * a rule that listed ONLY SMS becomes email-only when the workspace has email switched on for appointment messages, otherwise it
--     is switched OFF (and keeps WhatsApp and email as its channels for the owner to choose) with notice_code = 'sms_removed', which the
--     screen shows as "SMS reminders were removed; choose WhatsApp or Email";
--   * the workspace's SMS channel setting is switched off (the row stays, as history of what the owner chose).

ALTER TABLE booking_reminders ADD COLUMN notice_code text;
ALTER TABLE booking_reminders
  ADD CONSTRAINT chk_booking_reminders_notice CHECK (notice_code IS NULL OR notice_code IN ('sms_removed'));

-- A rule made from now on starts with WhatsApp, then email.
ALTER TABLE booking_reminders ALTER COLUMN channels SET DEFAULT ARRAY['whatsapp', 'email']::text[];

-- The tables are under FORCE ROW LEVEL SECURITY, so the migration raises the privileged flag for this transaction.
SELECT set_config('app.privileged', 'on', true);

-- 1. Rules that had only SMS (however many times it was listed) and a workspace that has email on: email only, with the note.
UPDATE booking_reminders r
   SET channels = ARRAY['email']::text[], notice_code = 'sms_removed'
 WHERE 'sms' = ANY (r.channels)
   AND cardinality(array_remove(r.channels, 'sms')) = 0
   AND EXISTS (SELECT 1 FROM appointment_channel_settings s
                WHERE s.org_id = r.org_id AND s.channel = 'email' AND s.enabled);

-- 2. Rules that had only SMS and a workspace without email: switched off, with the note and the two live channels to choose from.
UPDATE booking_reminders r
   SET channels = ARRAY['whatsapp', 'email']::text[], is_active = false, notice_code = 'sms_removed'
 WHERE 'sms' = ANY (r.channels)
   AND cardinality(array_remove(r.channels, 'sms')) = 0;

-- 3. Rules that listed SMS among other channels keep the others, in their order.
UPDATE booking_reminders
   SET channels = array_remove(channels, 'sms')
 WHERE 'sms' = ANY (channels);

-- 4. The owner's channel choice: SMS is off for every workspace.
UPDATE appointment_channel_settings
   SET enabled = false, default_sender_id = NULL
 WHERE channel = 'sms' AND (enabled OR default_sender_id IS NOT NULL);
