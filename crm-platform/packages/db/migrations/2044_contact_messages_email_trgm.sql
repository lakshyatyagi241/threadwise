-- @no-transaction
-- cms: trigram index for the operator inbox search on contact_messages.email (ContactService.list, ILIKE '%term%').
-- Why this migration exists: see 2043_contact_messages_name_trgm.sql. The search matches all four columns, so the planner needs
-- an index on each of them to serve the OR as a BitmapOr instead of a scan.
-- CONCURRENTLY, so building it does not block the public contact form's inserts; that is why this file runs outside a transaction
-- and holds exactly one statement.
-- Reversible: DROP INDEX CONCURRENTLY IF EXISTS idx_contact_messages_email_trgm.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_messages_email_trgm
  ON contact_messages USING gin (email gin_trgm_ops);
