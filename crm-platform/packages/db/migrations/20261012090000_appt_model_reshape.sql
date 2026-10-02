-- appt: the appointments and booking tables reshaped from the Reference draft into a model the slot engine, the status machine, the
-- reminder sweep and the public pages can rely on.
-- Why this migration exists: 20261001104800 drafted the ten tables as a straight copy of Reference (free-text status, a text
-- `active_slot_key` that only catches two bookings with the IDENTICAL start, a clear-text manage token, JSON blobs for reminders and
-- invitee details, no range checks) and holds no rows yet; TW-APPT-017..021, 038, 039 and the differences D-02..D-06, D-13, D-14, D-19
-- call those out. The draft is applied and immutable, so this fixes forward. Where an old row could break a new rule the UPDATEs below
-- make it valid first, so the migration also runs on a database that already has rows.

SELECT set_config('app.privileged', 'on', true);

-- Equality on bigint / smallint inside a GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --- booking_types ---------------------------------------------------------------------------------------------------------------

ALTER TABLE booking_types
  ADD COLUMN approval_required boolean NOT NULL DEFAULT false;

UPDATE booking_types SET name = left(btrim(name), 191) WHERE btrim(name) <> '' AND (name <> btrim(name) OR char_length(name) > 191);
UPDATE booking_types SET name = 'Service ' || id WHERE btrim(name) = '';
UPDATE booking_types SET slug = 'type-' || id WHERE btrim(slug) = '';
UPDATE booking_types SET duration_minutes = least(greatest(duration_minutes, 5), 1440);
UPDATE booking_types SET increment_minutes = least(greatest(increment_minutes, 5), 1440);
UPDATE booking_types SET buffer_before_minutes = least(greatest(buffer_before_minutes, 0), 1440),
                         buffer_after_minutes = least(greatest(buffer_after_minutes, 0), 1440);
UPDATE booking_types SET min_notice_minutes = least(greatest(min_notice_minutes, 0), 525600);
UPDATE booking_types SET max_advance_days = least(greatest(max_advance_days, 1), 365);
UPDATE booking_types SET max_per_day = NULL WHERE max_per_day IS NOT NULL AND (max_per_day < 1 OR max_per_day > 500);
UPDATE booking_types SET capacity = least(greatest(capacity, 1), 500);
UPDATE booking_types SET color = NULL WHERE color IS NOT NULL AND color !~ '^#[0-9a-fA-F]{6}$';

ALTER TABLE booking_types DROP CONSTRAINT chk_booking_types_location_type;
ALTER TABLE booking_types
  ADD CONSTRAINT chk_booking_types_location_type CHECK (location_type IN ('address', 'virtual', 'phone', 'whatsapp')),
  ADD CONSTRAINT chk_booking_types_name CHECK (btrim(name) <> '' AND char_length(name) <= 191),
  ADD CONSTRAINT chk_booking_types_slug CHECK (btrim(slug) <> ''),
  ADD CONSTRAINT chk_booking_types_color CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT chk_booking_types_duration CHECK (duration_minutes BETWEEN 5 AND 1440),
  ADD CONSTRAINT chk_booking_types_increment CHECK (increment_minutes BETWEEN 5 AND 1440),
  ADD CONSTRAINT chk_booking_types_buffers CHECK (buffer_before_minutes BETWEEN 0 AND 1440 AND buffer_after_minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT chk_booking_types_notice CHECK (min_notice_minutes BETWEEN 0 AND 525600),
  ADD CONSTRAINT chk_booking_types_advance CHECK (max_advance_days BETWEEN 1 AND 365),
  ADD CONSTRAINT chk_booking_types_per_day CHECK (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 500),
  ADD CONSTRAINT chk_booking_types_capacity CHECK (capacity BETWEEN 1 AND 500);

CREATE INDEX idx_booking_types_sort ON booking_types (org_id, sort_order, id);

-- --- weekly intervals and date overrides ------------------------------------------------------------------------------------------

-- `staff_id` was never written by Reference; a booking type has one host.
ALTER TABLE booking_availability_rules DROP COLUMN staff_id;
DELETE FROM booking_availability_rules WHERE weekday NOT BETWEEN 0 AND 6 OR end_time <= start_time;
ALTER TABLE booking_availability_rules
  ADD CONSTRAINT chk_booking_availability_rules_weekday CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_booking_availability_rules_hours CHECK (end_time > start_time);

-- A closed date has no hours; special hours need both ends (Reference stored the hours and ignored them: D-03).
UPDATE booking_availability_overrides SET start_time = NULL, end_time = NULL WHERE is_closed;
DELETE FROM booking_availability_overrides WHERE NOT is_closed AND (start_time IS NULL OR end_time IS NULL OR end_time <= start_time);
ALTER TABLE booking_availability_overrides
  ADD CONSTRAINT chk_booking_availability_overrides_hours CHECK (
    (is_closed AND start_time IS NULL AND end_time IS NULL)
    OR (NOT is_closed AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );

-- --- questions, reminders, templates, money ---------------------------------------------------------------------------------------

UPDATE booking_questions SET label = left(btrim(label), 191) WHERE btrim(label) <> '';
DELETE FROM booking_questions WHERE btrim(label) = '';
UPDATE booking_questions SET map_to_contact_field = CASE map_to_contact_field WHEN 'mobile' THEN 'phone'
  WHEN 'name' THEN 'name' WHEN 'email' THEN 'email' WHEN 'phone' THEN 'phone' ELSE NULL END
  WHERE map_to_contact_field IS NOT NULL;
ALTER TABLE booking_questions
  ADD CONSTRAINT chk_booking_questions_label CHECK (btrim(label) <> '' AND char_length(label) <= 191),
  ADD CONSTRAINT chk_booking_questions_map CHECK (map_to_contact_field IS NULL OR map_to_contact_field IN ('name', 'email', 'phone'));

-- Reminders: the position handle (`offset_index`) is rewritten in a batch when a type is saved, so its uniqueness is checked at commit.
DELETE FROM booking_reminders WHERE offset_minutes < 1 OR offset_minutes > 43200;
ALTER TABLE booking_reminders DROP CONSTRAINT uq_booking_reminders_booking_type_id_offset_index;
ALTER TABLE booking_reminders
  ADD CONSTRAINT uq_booking_reminders_booking_type_id_offset_index UNIQUE (org_id, booking_type_id, offset_index) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT uq_booking_reminders_booking_type_id_offset_minutes UNIQUE (org_id, booking_type_id, offset_minutes) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT chk_booking_reminders_offset CHECK (offset_minutes BETWEEN 1 AND 43200 AND offset_index BETWEEN 0 AND 7);

-- The lifecycle messages go out by email too (D-14).
ALTER TABLE booking_templates DROP CONSTRAINT chk_booking_templates_channel;
ALTER TABLE booking_templates
  ADD CONSTRAINT chk_booking_templates_channel CHECK (channel IN ('whatsapp', 'email', 'telegram', 'instagram', 'facebook'));

UPDATE booking_financials SET currency = upper(btrim(currency)) WHERE currency IS NOT NULL;
UPDATE booking_financials SET currency = NULL WHERE currency IS NOT NULL AND currency !~ '^[A-Z]{3}$';
UPDATE booking_financials SET fee_minor = greatest(fee_minor, 0), deposit_value_minor = greatest(deposit_value_minor, 0),
  cancel_fee_minor = greatest(cancel_fee_minor, 0), no_show_fee_minor = greatest(no_show_fee_minor, 0),
  cancel_window_minutes = greatest(cancel_window_minutes, 0), tax_pct = least(greatest(tax_pct, 0), 100);
ALTER TABLE booking_financials
  ADD CONSTRAINT chk_booking_financials_amounts CHECK (fee_minor >= 0 AND deposit_value_minor >= 0 AND cancel_fee_minor >= 0 AND no_show_fee_minor >= 0),
  ADD CONSTRAINT chk_booking_financials_tax CHECK (tax_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_booking_financials_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT chk_booking_financials_window CHECK (cancel_window_minutes >= 0);

DELETE FROM slot_reservations WHERE ends_at <= starts_at OR seats < 1;
ALTER TABLE slot_reservations
  ADD CONSTRAINT chk_slot_reservations_range CHECK (ends_at > starts_at),
  ADD CONSTRAINT chk_slot_reservations_seats CHECK (seats >= 1);

-- --- appointments ---------------------------------------------------------------------------------------------------------------

-- Dead in Reference (never written) or replaced below.
ALTER TABLE appointments
  DROP COLUMN staff_id,
  DROP COLUMN capacity_used,
  DROP COLUMN reminders_sent,
  DROP COLUMN active_slot_key,
  DROP COLUMN manage_token;

-- The calendar target is vendor-neutral here: any CalendarSyncPort adapter writes these two.
ALTER TABLE appointments RENAME COLUMN google_event_id TO calendar_event_id;
ALTER TABLE appointments RENAME COLUMN google_calendar_id TO calendar_id;
ALTER INDEX idx_appointments_google_event_id RENAME TO idx_appointments_calendar_event_id;

UPDATE appointments SET starts_at = coalesce(starts_at, created_at);
UPDATE appointments SET ends_at = coalesce(ends_at, starts_at + interval '30 minutes');
UPDATE appointments SET ends_at = starts_at + interval '30 minutes' WHERE ends_at <= starts_at;
UPDATE appointments SET status = 'pending' WHERE status NOT IN ('pending', 'confirmed', 'cancelled', 'declined', 'completed', 'no_show');
UPDATE appointments SET deposit_paid_minor = 0 WHERE deposit_paid_minor < 0;

ALTER TABLE appointments
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  -- Who and what, as typed at booking time (the contact link may be absent or later deleted).
  ADD COLUMN invitee_name text,
  ADD COLUMN invitee_email text,
  ADD COLUMN invitee_phone text,
  -- Staff notes, encrypted at rest (AES-GCM through CryptoService), never copied to an audit row or an event.
  ADD COLUMN notes text,
  -- The customer's manage link: only its SHA-256 is looked up; an encrypted copy lets staff copy the link (D-19).
  ADD COLUMN manage_token_hash text,
  ADD COLUMN manage_token_cipher text,
  -- Which seat of a capacity-N type this booking holds (1 for a one-to-one type); the exclusion constraint below is per seat.
  ADD COLUMN seat smallint NOT NULL DEFAULT 1,
  -- When the reminders were last (re)armed: at booking and at every move. A reminder whose time is not after it never fires
  -- (Reference: "skip when the booking was made inside the reminder window").
  ADD COLUMN armed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text,
  ADD COLUMN cancel_reason text,
  -- The price at booking time (fee + tax), what was due to book, and a cancel or no-show fee recorded against it. Minor units.
  ADD COLUMN price_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN currency text,
  ADD COLUMN due_now_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN fee_recorded_minor bigint NOT NULL DEFAULT 0,
  -- An unpaid pending booking holds its slot until then; the lifecycle sweep cancels it afterwards.
  ADD COLUMN hold_expires_at timestamptz;

UPDATE appointments SET invitee_name = left(meta ->> 'customer_name', 191),
                        invitee_email = left(meta ->> 'customer_email', 191),
                        invitee_phone = left(meta ->> 'customer_phone', 32)
  WHERE meta IS NOT NULL;
UPDATE appointments SET status_changed_at = updated_at;
UPDATE appointments SET cancelled_at = updated_at, cancelled_by = 'staff' WHERE status = 'cancelled';

ALTER TABLE appointments
  ADD CONSTRAINT chk_appointments_status CHECK (status IN ('pending', 'confirmed', 'cancelled', 'declined', 'completed', 'no_show')),
  ADD CONSTRAINT chk_appointments_range CHECK (ends_at > starts_at),
  ADD CONSTRAINT chk_appointments_seat CHECK (seat >= 1),
  ADD CONSTRAINT chk_appointments_cancelled_by CHECK (cancelled_by IS NULL OR cancelled_by IN ('staff', 'invitee', 'system')),
  ADD CONSTRAINT chk_appointments_money CHECK (price_minor >= 0 AND due_now_minor >= 0 AND fee_recorded_minor >= 0 AND deposit_paid_minor >= 0),
  ADD CONSTRAINT chk_appointments_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT uq_appointments_manage_token_hash UNIQUE (manage_token_hash);

-- THE double-booking guarantee (D-05, EXT-APPT-05): no two pending or confirmed bookings of one booking type may hold the same seat
-- over overlapping time. The application serialises bookings of a type with an advisory lock and checks buffers and capacity; this
-- constraint is the backstop that holds even if a code path forgets the lock or two workers race. A cancelled, declined, completed or
-- no-show booking no longer holds the slot, so the same statement that changes the status frees it. Half-open ranges: a booking that
-- ends at 10:00 and one that starts at 10:00 do not collide.
ALTER TABLE appointments
  ADD CONSTRAINT excl_appointments_seat_time EXCLUDE USING gist (
    org_id WITH =,
    booking_type_id WITH =,
    seat WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('pending', 'confirmed') AND booking_type_id IS NOT NULL);

DROP INDEX IF EXISTS idx_appointments_staff_id;
CREATE INDEX idx_appointments_user_id ON appointments (org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_appointments_status_starts ON appointments (org_id, status, starts_at, id);
CREATE INDEX idx_appointments_starts_id ON appointments (org_id, starts_at, id);
-- The sweeps (every organization at once, so no org_id prefix): reminders and lifecycle.
CREATE INDEX idx_appointments_confirmed_starts ON appointments (starts_at) WHERE status = 'confirmed';
CREATE INDEX idx_appointments_hold_expiry ON appointments (hold_expires_at) WHERE status = 'pending' AND hold_expires_at IS NOT NULL;
CREATE INDEX idx_appointments_pending_ends ON appointments (ends_at) WHERE status = 'pending';
-- The list's search box: title and the invitee's name, email and phone (ILIKE '%word%').
CREATE INDEX idx_appointments_search_trgm ON appointments USING gin (
  (coalesce(title, '') || ' ' || coalesce(invitee_name, '') || ' ' || coalesce(invitee_email, '') || ' ' || coalesce(invitee_phone, '')) gin_trgm_ops
);

-- --- the reminder claims ----------------------------------------------------------------------------------------------------------

-- One row per (appointment, reminder, offset) that the sweep has announced. The unique key IS the idempotency: two workers, a retry
-- or a restart can all try to claim the same reminder and exactly one insert wins. A reschedule deletes the booking's claims so every
-- offset is armed again. Rows are written once and never updated, so there is no row_version.
CREATE TABLE appointment_reminder_runs (
  org_id         bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id             bigint GENERATED BY DEFAULT AS IDENTITY,
  appointment_id bigint NOT NULL,
  reminder_id    bigint,
  offset_minutes integer NOT NULL,
  due_at         timestamptz NOT NULL,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  CONSTRAINT uq_appointment_reminder_runs UNIQUE (org_id, appointment_id, offset_minutes),
  CONSTRAINT fk_appointment_reminder_runs_appointment FOREIGN KEY (org_id, appointment_id)
    REFERENCES appointments (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_reminder_runs_reminder FOREIGN KEY (org_id, reminder_id)
    REFERENCES booking_reminders (org_id, id) ON DELETE SET NULL (reminder_id)
);
CREATE INDEX idx_appointment_reminder_runs_appointment ON appointment_reminder_runs (org_id, appointment_id);

ALTER TABLE appointment_reminder_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_reminder_runs FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_reminder_runs FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
