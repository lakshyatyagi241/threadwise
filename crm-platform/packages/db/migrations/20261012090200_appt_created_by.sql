-- appt: who created an appointment (staff), so the record scope `own` can mean "I host it or I booked it" (D-02), as tasks do.
-- Why a separate file: 20261012090000 is applied (and checksummed) on the shared dev database; this fixes forward. A booking made
-- from the public page or a chat flow has no staff creator (NULL).
ALTER TABLE appointments ADD COLUMN created_by bigint;
ALTER TABLE appointments
  ADD CONSTRAINT fk_appointments_created_by FOREIGN KEY (org_id, created_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);
CREATE INDEX idx_appointments_created_by ON appointments (org_id, created_by) WHERE created_by IS NOT NULL;
