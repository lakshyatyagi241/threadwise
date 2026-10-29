-- @no-transaction
-- cms: trigram index for the operator inbox search on contact_messages.message (ContactService.list, ILIKE '%term%').
-- Why this migration exists: see 2043_contact_messages_name_trgm.sql. The message body is the column most searches scan.
-- The cost is one GIN update per public insert; the trade is accepted because the public form inserts at contact volume, not
-- at contacts-table volume, and a seq scan of the whole inbox on every search grows with spam.
-- CONCURRENTLY, so building it does not block the public contact form's inserts; that is why this file runs outside a transaction
-- and holds exactly one statement.
-- Reversible: DROP INDEX CONCURRENTLY IF EXISTS idx_contact_messages_message_trgm.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_messages_message_trgm
  ON contact_messages USING gin (message gin_trgm_ops);
