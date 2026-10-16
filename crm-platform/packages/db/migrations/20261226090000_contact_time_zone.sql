-- BL-193: a contact time zone you can see. The quiet hours (BL-177) read the contact's own clock; until now that clock came from a
-- contact property of type time zone that no screen filled in. The zone is now a column of the contact, with where it came from, so a
-- person (or an import, or an API client) can set it, a screen can show it, and an inferred zone never overwrites a chosen one.
--
-- `timezone` is an IANA zone name (checked by the application against the runtime's zone list). `timezone_source` says who set it:
-- `staff` (typed in the app, a bulk edit), `import` (a CSV import) or `api` (the REST API). Both are null together: a contact with no
-- stored zone is read on the country code of its number, then the workspace fallback (the send window decision explains which).
-- Additive: both columns are nullable, nothing is rewritten, the old code ignores them. RLS is unchanged (the table has it forced).
ALTER TABLE contacts
  ADD COLUMN timezone text,
  ADD COLUMN timezone_source text,
  ADD CONSTRAINT ck_contacts_timezone_source CHECK (timezone_source IS NULL OR timezone_source IN ('staff', 'import', 'api')),
  ADD CONSTRAINT ck_contacts_timezone_pair CHECK ((timezone IS NULL) = (timezone_source IS NULL)),
  ADD CONSTRAINT ck_contacts_timezone_len CHECK (timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 64);

-- The filter "time zone is X" and "no time zone set" on the contact list.
CREATE INDEX idx_contacts_org_timezone ON contacts (org_id, timezone) WHERE timezone IS NOT NULL;
