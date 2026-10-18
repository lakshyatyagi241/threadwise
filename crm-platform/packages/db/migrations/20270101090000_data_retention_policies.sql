-- 20270101090000_data_retention_policies
-- A super admin sets, per data item, how long it stays live and how long the cold archive then keeps it. Until now these numbers were
-- constants in code (60 live days for the analytics events, the security policy's 365 days for the audit log, 7 days for an export file)
-- and only the analytics stream could be archived at all.
--
--   data_retention_policies  one row per item the admin has saved. NO ROW = today's behaviour; nothing destructive changes for an item
--                            until its row exists, and deleting the row (reset) returns it to the default.
--   data_retention_runs      what the last run did for each item and how big the archive is, so the console can show it without
--                            listing the object store on every page load. Written by the workers, read by the console.
--
-- Platform tables: no org_id, privileged-only RLS, like platform_settings.
--
-- The audit log joins the streams drop_closed_partition() may drop. Its partitions are still only dropped after the retention job has
-- exported them, read them back and compared counts (partition-archiver), and the job only touches audit_log once a policy row exists.

CREATE TABLE data_retention_policies (
  item         text PRIMARY KEY,
  live_days    integer NOT NULL,
  archive_days integer,
  row_version  integer NOT NULL DEFAULT 1,
  updated_by   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_retention_item CHECK (item ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT chk_retention_live CHECK (live_days >= 1),
  -- Archive days count from the day the data leaves the live window, so deletion is always live + archive days after the write:
  -- it cannot come before archiving. NULL keeps the archive for ever.
  CONSTRAINT chk_retention_archive CHECK (archive_days IS NULL OR archive_days >= 1)
);

CREATE TABLE data_retention_runs (
  item                text PRIMARY KEY,
  last_run_at         timestamptz NOT NULL,
  mode                text NOT NULL,
  outcome             text NOT NULL,
  archived_months     integer NOT NULL DEFAULT 0,
  archived_rows       bigint NOT NULL DEFAULT 0,
  archived_bytes      bigint NOT NULL DEFAULT 0,
  expired_items       bigint NOT NULL DEFAULT 0,
  deleted_rows        bigint NOT NULL DEFAULT 0,
  error               text,
  archive_objects     bigint,
  archive_bytes       bigint,
  archive_measured_at timestamptz,
  CONSTRAINT chk_retention_runs_item CHECK (item ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT chk_retention_runs_mode CHECK (mode IN ('live', 'dry_run')),
  CONSTRAINT chk_retention_runs_outcome CHECK (outcome IN ('ok', 'partial', 'failed'))
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_retention_policies', 'data_retention_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY privileged_only ON %I FOR ALL
        USING      (app_is_privileged())
        WITH CHECK (app_is_privileged())
    $p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_worker', t);
  END LOOP;
END $$;

CREATE TRIGGER trg_data_retention_policies_touch BEFORE UPDATE ON data_retention_policies
  FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE OR REPLACE FUNCTION archivable_streams()
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_temp
AS $$ SELECT ARRAY['an_events', 'audit_log']::text[] $$;

REVOKE ALL ON FUNCTION archivable_streams() FROM PUBLIC;
