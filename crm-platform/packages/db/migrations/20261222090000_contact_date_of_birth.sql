-- contact date of birth and the automatic minor flag (BL-217, spec docs/specs/privacy-and-data-governance.md section 11.10).
--
-- Why this migration exists. Forms, widgets and chatbots collect a name, an email and a phone number, so the minor flag of BL-180 could
-- only ever be set by hand. A form, a chat intake or a flow can now ask for a date of birth (or an age), and the contact keeps the date.
--
--   contacts.date_of_birth        a built-in contact property (like title or address), personal data of the identifier class. A column,
--                                 not a custom field, because it must be sorted, filtered and swept by an index. Nullable and
--                                 additive: nothing is backfilled and no existing statement is affected.
--
--   contact_privacy_flags
--     minor_until                 the day a flag set from a date of birth (or an age) lapses by itself; NULL for a flag a person set.
--                                 The nightly birthday sweep lifts ONLY flags whose source is 'dob' and whose day has come.
--     dob_override_for            a person cleared the flag while the date of birth still said "minor": the date they reviewed. The
--                                 sweep does not flag the contact again until the date of birth changes.
--
--   source 'dob' | 'import' | 'flow' | 'declaration'   new values of the flag and event source (checked, so a typo cannot slip in).
--                                 'dob' is the system acting on a date or an age; 'import' a CSV column; 'flow' a chatbot flow that
--                                 learned of a minor; 'declaration' a visitor who did not confirm the minimum age on a form.

ALTER TABLE contacts ADD COLUMN date_of_birth date;
-- The upper bound (not in the future) depends on the clock, so the application checks it; the table only refuses an impossible past.
ALTER TABLE contacts ADD CONSTRAINT ck_contacts_date_of_birth CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');
-- The minor filter, the birthday sweep and the "date of birth" segment condition: contacts of one workspace with a date, newest first.
CREATE INDEX idx_contacts_date_of_birth ON contacts (org_id, date_of_birth DESC) WHERE date_of_birth IS NOT NULL;

ALTER TABLE contact_privacy_flags
  ADD COLUMN minor_until      date,
  ADD COLUMN dob_override_for date;

ALTER TABLE contact_privacy_flags DROP CONSTRAINT ck_privacy_flags_sources;
ALTER TABLE contact_privacy_flags ADD CONSTRAINT ck_privacy_flags_sources CHECK (
  (minor_source IS NULL OR minor_source IN ('manual', 'api', 'contact_request', 'gpc', 'dob', 'import', 'flow', 'declaration'))
  AND (dns_source IS NULL OR dns_source IN ('manual', 'api', 'contact_request', 'gpc', 'dob', 'import', 'flow', 'declaration'))
);
-- Only a flag from a date of birth lapses by itself.
ALTER TABLE contact_privacy_flags ADD CONSTRAINT ck_privacy_flags_until CHECK (minor_until IS NULL OR (is_minor AND minor_source = 'dob'));

ALTER TABLE contact_privacy_events DROP CONSTRAINT ck_privacy_events_source;
ALTER TABLE contact_privacy_events ADD CONSTRAINT ck_privacy_events_source CHECK (
  source IN ('manual', 'api', 'contact_request', 'gpc', 'dob', 'import', 'flow', 'declaration')
);

-- The sweep's two questions: "whose flag lapses today or earlier" (this index) and "whose date says minor but is not flagged"
-- (idx_contacts_date_of_birth above, left-joined to the flags).
CREATE INDEX idx_privacy_flags_minor_until ON contact_privacy_flags (minor_until, org_id, contact_id)
  WHERE is_minor AND minor_source = 'dob' AND minor_until IS NOT NULL;
