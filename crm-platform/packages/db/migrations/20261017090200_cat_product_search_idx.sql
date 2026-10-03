-- @no-transaction
-- cat: trigram index for the product search box (TW-CAT-019, 024).
-- Why this migration exists: the search matches the typed text against the name with ILIKE '%text%', which a btree cannot
-- serve; a trigram GIN index can. CONCURRENTLY, so building it does not block writes on a live table; that is why this file runs
-- outside a transaction and holds exactly one statement (the runner sends a file as one query).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_products_name_trgm
  ON wa_products USING gin (name gin_trgm_ops);
