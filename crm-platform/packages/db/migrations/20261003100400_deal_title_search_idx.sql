-- @no-transaction
-- deal: trigram index for the board's search box (TW-DEAL-004) on the deal title.
-- Why this migration exists: the board and the list match the title with ILIKE '%word%', which a btree cannot serve and which
-- Reference answered with a scan. CONCURRENTLY so it does not block writes on a live table, which is why this file runs
-- outside a transaction and holds exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_title_trgm
  ON deals USING gin (title gin_trgm_ops);
