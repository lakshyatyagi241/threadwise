-- @no-transaction
-- company: trigram index for the companies search box on the name (TW-CTP-002).
-- Why this migration exists: the list matches the name with ILIKE '%word%', which a btree cannot serve and which Reference answered by
-- loading the newest 500 rows and filtering in PHP. CONCURRENTLY so it does not block writes on a live table, which is why this
-- file runs outside a transaction and holds exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_name_trgm
  ON companies USING gin (name gin_trgm_ops);
