-- @no-transaction
-- con: trigram index for the contact search box (TW-CON-002), on the name.
-- Why this migration exists: the search matches every word of the query against the name, the email and the digits of the
-- phone with ILIKE '%word%'. A btree cannot serve a leading wildcard; a trigram GIN index can, which is the difference
-- between an indexed lookup and a scan of the whole book on a 500k-contact workspace (Reference answered by loading and
-- decrypting all of them on every request). CONCURRENTLY, so building it does not block writes on a live table; that is
-- why this file runs outside a transaction, and why it holds exactly one statement (the runner sends a file as one query,
-- and CONCURRENTLY refuses to share one with anything else).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_name_trgm
  ON contacts USING gin (name gin_trgm_ops);
