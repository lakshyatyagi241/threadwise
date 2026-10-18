-- contact_meetings: let a meeting row be the mirror of a booking (BL-281).
-- Why this migration exists. A contact's Meetings tab only ever showed what a person typed in. A customer who books through the public
-- booking page, the chat flow, the API or a staff member's "new appointment" created an `appointments` row and nothing on the contact's
-- Meetings tab, so one conversation lived in two places that never agreed. The Appointments section stays as it is; this adds the link
-- that lets the booking ALSO appear in Meetings, kept in step by the application in the same transaction as the appointment write.
--
--   source          'manual' (typed in, the only kind until now) or 'booking' (mirrored from an appointment).
--   appointment_id  the appointment a 'booking' row mirrors. ON DELETE SET NULL (appointment_id): deleting an appointment must not
--                   delete or break the contact's history, and the column-restricted form leaves org_id alone (0019).
--   join_url        the web address that joins the call (BL-245's link column). `location` stays for places; a person who pasted a link
--                   into `location` before keeps it there.
--
-- One booking, one meeting: the partial unique index makes a second row for the same appointment impossible, so the application's upsert
-- (and the back-fill job, which can run twice) is idempotent by construction.
--
-- Additive: no existing row or statement changes. Existing rows read as source 'manual' with no appointment and no link. The rows for
-- bookings that already exist are written by the worker's back-fill job, not here, so a large workspace is not locked by a migration.

ALTER TABLE contact_meetings
  ADD COLUMN source         text   NOT NULL DEFAULT 'manual',
  ADD COLUMN appointment_id bigint,
  ADD COLUMN join_url       text;

ALTER TABLE contact_meetings
  ADD CONSTRAINT ck_contact_meetings_source CHECK (source IN ('manual', 'booking')),
  -- A typed-in meeting never points at an appointment; a booking row may lose its appointment (SET NULL below), so no reverse rule.
  ADD CONSTRAINT ck_contact_meetings_appointment_source CHECK (appointment_id IS NULL OR source = 'booking'),
  ADD CONSTRAINT ck_contact_meetings_join_url CHECK (join_url IS NULL OR char_length(join_url) <= 2048),
  ADD CONSTRAINT fk_contact_meetings_appointment
    FOREIGN KEY (org_id, appointment_id) REFERENCES appointments (org_id, id) ON DELETE SET NULL (appointment_id);

CREATE UNIQUE INDEX uq_contact_meetings_appointment
  ON contact_meetings (org_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
