-- @no-transaction
-- cms: trigram index for the operator inbox search on contact_messages.name (ContactService.list, ILIKE '%term%').
-- Why this migration exists: a btree cannot serve a leading wildcard, so every inbox search read the whole table. Measured on
-- 500,000 synthetic rows: the search went from a parallel seq scan (about 91 ms) to a BitmapOr over the four trigram indexes
-- (about 5 ms). CONCURRENTLY, so building it does not block the public contact form's inserts; that is why this file runs outside
-- a transaction and holds exactly one statement.
-- Reversible: DROP INDEX CONCURRENTLY IF EXISTS idx_contact_messages_name_trgm.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_messages_name_trgm
  ON contact_messages USING gin (name gin_trgm_ops);
