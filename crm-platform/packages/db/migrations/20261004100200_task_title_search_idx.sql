-- @no-transaction
-- task: trigram index for the task search box on the title (notes are encrypted, so only the title is searchable, D-16).
-- Why this migration exists: the list matches the title with ILIKE '%word%', which a btree cannot serve. CONCURRENTLY so it does
-- not block writes on a live table, which is why this file runs outside a transaction and holds exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_title_trgm
  ON tasks USING gin (title gin_trgm_ops);
