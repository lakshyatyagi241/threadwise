-- @no-transaction
-- con: index on the digits of a contact's phone, for matching an uploaded CSV of numbers to contacts.
-- Why this migration exists: the broadcast wizard's "Broadcast via CSV" mode matches each uploaded number to a contact by
-- `regexp_replace(coalesce(normalized_phone, phone, ''), '\D', '', 'g')`; with no index on that expression every count, report and
-- launch scanned all of the workspace's contacts. The expression is written exactly as the matching SQL writes it
-- (apps/api/src/modules/campaigns/wizard/wizard-csv-sql.ts). CONCURRENTLY, outside a transaction, one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_phone_digits
  ON contacts (org_id, (regexp_replace(coalesce(normalized_phone, phone, ''), '\D', '', 'g')));
