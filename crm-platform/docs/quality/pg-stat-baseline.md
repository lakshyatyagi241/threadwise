# Production pg_stat_statements baseline

This is the runbook for capturing the top-query baseline from production. It is read-only. The numbers in
[performance-testing.md](performance-testing.md) come from load tests on a test database; they are not production
figures. Use this runbook when a slow-query question comes up and the team needs production numbers to compare.

## What you need

- A read-only database role for the production database. Ask the person who holds production access to create it
  (for example a role with `GRANT pg_read_all_stats TO <role>` and `CONNECT` on the database). Do not use the application
  or worker roles.
- The `pg_stat_statements` extension installed in that database (`SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';`).
  If it is missing, stop: installing it is a change for the person who runs production, not for this runbook.
- `pg_stat_statements` listed in `shared_preload_libraries` on the server. Without it the script stops with
  `pg_stat_statements must be loaded via shared_preload_libraries`. Checking or changing that setting is for the person who runs production.
- `psql` 16 or later on your machine.

Keep the connection string in your shell or a password manager. Do not paste it into a commit, an issue, a PR or a chat.

## Steps

1. Export the connection string for the read-only role in your shell, for example `export PG_READ_URL='postgresql://...'`.
2. Run the capture. The script sets `default_transaction_read_only = on` itself, so a write cannot happen even if the
   role has one:

   ```bash
   psql "$PG_READ_URL" -v ON_ERROR_STOP=1 -f tools/perf/pg-stat-baseline.sql > baseline-$(date -u +%F).txt
   ```

3. Read the file. It lists up to 50 statements ordered by total execution time, with `calls`, `total_ms`, `mean_ms`,
   `stddev_ms`, `rows` and the first 200 characters of each query.
4. Redact before sharing. Query text can carry customer values in literals. Replace any string or number literal you
   see with `?` before the file leaves your machine.
5. Save the redacted file in the team's shared performance folder, named with the capture date and the release it was
   taken on.

## Diffing two captures

`pg_stat_statements` counters are cumulative since the last reset. Only compare two captures taken on the same
statistics window, or capture `pg_stat_statements_reset()` steps yourself with the owner's approval (a reset needs
write rights and is not part of this runbook). To compare, match rows by the `query` column and compare `mean_ms` and
`calls`. A query that appears in only one capture is new or was removed, not necessarily faster or slower.

## Not covered here

- Query plans: use `EXPLAIN (ANALYZE, BUFFERS)` on the query, on a copy of the data, as described in
  [performance-testing.md](performance-testing.md).
- Enabling `pg_stat_statements` or changing its settings.
