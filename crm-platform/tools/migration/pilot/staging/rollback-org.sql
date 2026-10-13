-- rollback-org.sql: remove ONE migrated organization completely (the app has no organization delete/purge path; see STAGING-RUNBOOK.md step 10).
--
--   psql -v ON_ERROR_STOP=1 -v slug=<org slug> [-v commit=1] -f rollback-org.sql
--
-- Run as the database OWNER (a superuser: it needs session_replication_role). Default is a DRY RUN: it prints how many rows each table
-- would lose and rolls back. `-v commit=1` really deletes. One transaction: all or nothing.
--
-- What it does, and why it can be this blunt:
--   * only an organization the migration tool created (organizations.settings.legacy.waboo.client is set) is accepted;
--   * triggers are switched off for the transaction (session_replication_role = replica): the immutable-ledger / audit triggers would
--     otherwise refuse to delete wallet_transactions and audit rows, and the foreign-key actions would not be needed anyway because
--     EVERY table that has an org_id column is emptied for this organization explicitly (partitioned tables have no foreign keys);
--   * then the organizations row, then the tool's own bookkeeping for that client (migration.id_map / quarantine / run_log);
--   * finally every foreign key that points at organizations(id) is checked for a row still pointing at the organization: any left
--     aborts the whole transaction.
-- Not touched: other organizations, global tables (plans, message_rates, permission_defs ...), files in object storage (the tool writes
-- none), Redis (it holds no migrated data). Sequences are not rewound (ids are not reused).
\if :{?slug}
\else
  \echo 'usage: psql -v ON_ERROR_STOP=1 -v slug=<org slug> [-v commit=1] -f rollback-org.sql'
  \quit
\endif
\if :{?commit}
\else
  \set commit 0
\endif

BEGIN;
SET LOCAL session_replication_role = replica;

SELECT count(*) = 1 AS rb_found FROM organizations WHERE slug = :'slug' \gset
\if :rb_found
\else
  DO $$ BEGIN RAISE EXCEPTION 'no organization with that slug'; END $$;
\endif
SELECT id AS rb_org, (settings #>> '{legacy,waboo,client}') IS NOT NULL AS rb_migrated, COALESCE(settings #>> '{legacy,waboo,client}', '') AS rb_client
FROM organizations WHERE slug = :'slug' \gset
\if :rb_migrated
\else
  DO $$ BEGIN RAISE EXCEPTION 'that organization was not created by the migration tool (no settings.legacy.waboo.client): refusing'; END $$;
\endif
SELECT set_config('rb.org', :'rb_org', true) AS a, set_config('rb.client', :'rb_client', true) AS b \gset rb_ignore_

CREATE TEMP TABLE rb_report (tbl text PRIMARY KEY, rows_deleted bigint NOT NULL) ON COMMIT DROP;

DO $$
DECLARE
  t record;
  n bigint;
  org bigint := current_setting('rb.org')::bigint;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relnamespace = 'public'::regnamespace
    ORDER BY c.relname
  LOOP
    EXECUTE format('DELETE FROM %I WHERE org_id = $1', t.relname) USING org;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN INSERT INTO rb_report VALUES (t.relname, n); END IF;
  END LOOP;

  DELETE FROM organizations WHERE id = org;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rb_report VALUES ('organizations', n);

  IF to_regclass('migration.id_map') IS NOT NULL THEN
    DELETE FROM migration.id_map WHERE target_org_id = org OR source_client = current_setting('rb.client');
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO rb_report VALUES ('migration.id_map', n);
    DELETE FROM migration.quarantine WHERE source_client = current_setting('rb.client');
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO rb_report VALUES ('migration.quarantine', n);
    DELETE FROM migration.run_log WHERE source_client = current_setting('rb.client');
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO rb_report VALUES ('migration.run_log', n);
  END IF;

  -- nothing may still point at the organization through a foreign key
  FOR t IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.organizations'::regclass AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', t.tbl, t.col) INTO n USING org;
    IF n > 0 THEN
      RAISE EXCEPTION '% rows of % still reference the organization through %: nothing was deleted', n, t.tbl, t.col;
    END IF;
  END LOOP;
END $$;

\echo 'rows removed per table (organization slug :slug):'
SELECT tbl, rows_deleted FROM rb_report ORDER BY tbl;
SELECT sum(rows_deleted) AS total_rows_removed FROM rb_report;

\if :commit
  COMMIT;
  \echo 'COMMITTED: the organization is gone.'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back, nothing was deleted. Run again with -v commit=1 to delete.'
\endif
