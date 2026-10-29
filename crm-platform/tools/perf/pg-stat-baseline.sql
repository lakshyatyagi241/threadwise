-- Read-only capture of the top statements from pg_stat_statements.
-- Run with a read-only role, for example:
--   psql "$PG_READ_URL" -v ON_ERROR_STOP=1 -f tools/perf/pg-stat-baseline.sql > baseline-$(date -u +%F).txt
-- Needs the pg_stat_statements extension installed in the database and
-- PostgreSQL 13 or later (total_exec_time, mean_exec_time, stddev_exec_time).
-- See docs/quality/pg-stat-baseline.md. Contains no credentials; query text is truncated to 200 characters.
\set QUIET on
SET default_transaction_read_only = on;
\pset format aligned
\pset border 1
SELECT
  s.calls,
  round(s.total_exec_time::numeric, 1)  AS total_ms,
  round(s.mean_exec_time::numeric, 2)   AS mean_ms,
  round(s.stddev_exec_time::numeric, 2) AS stddev_ms,
  s.rows,
  left(regexp_replace(s.query, '\s+', ' ', 'g'), 200) AS query
FROM pg_stat_statements AS s
JOIN pg_database AS d ON d.oid = s.dbid
WHERE d.datname = current_database()
ORDER BY s.total_exec_time DESC
LIMIT 50;
