-- pg_stat_statements: per-statement calls, total/mean time and rows, so slow queries can be ranked (QA 41).
--
-- The compose files preload the library (shared_preload_libraries=pg_stat_statements); this creates the view in the database.
-- Guarded like the vector extension in 0001: a managed Postgres that does not allow the extension, or a plain server without the
-- preload, must not fail the migration run. Without the extension the slow-query check reports it missing; nothing else depends on it.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements unavailable (%): slow-query ranking will use the log only', SQLERRM;
END $$;
