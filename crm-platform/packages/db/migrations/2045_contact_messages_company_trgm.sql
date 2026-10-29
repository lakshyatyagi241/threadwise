-- @no-transaction
-- cms: trigram index for the operator inbox search on contact_messages.company (ContactService.list, ILIKE '%term%').
-- Why this migration exists: see 2043_contact_messages_name_trgm.sql. The company column is nullable and is part of the OR.
-- CONCURRENTLY, so building it does not block the public contact form's inserts; that is why this file runs outside a transaction
-- and holds exactly one statement.
-- Reversible: DROP INDEX CONCURRENTLY IF EXISTS idx_contact_messages_company_trgm.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_messages_company_trgm
  ON contact_messages USING gin (company gin_trgm_ops);
