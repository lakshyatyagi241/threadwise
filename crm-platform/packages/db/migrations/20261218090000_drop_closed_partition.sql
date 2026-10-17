-- 20261218090000_drop_closed_partition
-- The retention job (apps/api/src/modules/data-retention) exports a closed monthly partition to the archive, checks the copy, and then has
-- to drop the partition. The runtime roles own no table, so DROP TABLE and DETACH PARTITION fail for them with "must be owner" (see
-- 20261001110000_partition_definer for the same problem on the create side). This gives them one narrow way to do it, as
-- ensure_monthly_partition does for creation.
--
-- Dropping is the one irreversible thing the job does, so the function refuses everything it cannot prove is safe:
--
--   * Only streams named by archivable_streams() can be dropped. The list is the streams whose readers have all moved to the rollups and
--     whose cut the owner has approved (an_events today). A bug, or a caller that passes `messages` or `wallet_transactions`, is refused
--     here and never reaches DROP. Each later phase adds its stream by replacing archivable_streams() in its own migration.
--   * The parent must be a RANGE-partitioned table in public that is not itself a partition.
--   * The month must have ended at least 7 days ago. Whatever the policy says, a current or just-closed month is never dropped.
--   * The named table must exist, be a partition of that parent, and not be the DEFAULT partition.
--   * Detach waits at most 3 seconds for its lock. DETACH needs an exclusive lock on the parent for a moment; waiting longer would stall
--     every writer of the stream behind it. The job simply tries again the next night.
--
-- It does not know about the archive: checking that the data is safely stored is the caller's job and happens before the call.
-- EXECUTE goes to crm_worker only (the API role cannot drop anything), unlike ensure_monthly_partition.

CREATE OR REPLACE FUNCTION archivable_streams()
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_temp
AS $$ SELECT ARRAY['an_events']::text[] $$;

REVOKE ALL ON FUNCTION archivable_streams() FROM PUBLIC;

CREATE OR REPLACE FUNCTION drop_closed_partition(parent regclass, at_month date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  parent_name text;
  start_ts    date := date_trunc('month', at_month)::date;
  end_ts      date := (date_trunc('month', at_month) + interval '1 month')::date;
  part_name   text;
  part        regclass;
BEGIN
  SELECT c.relname INTO parent_name
  FROM pg_partitioned_table p
  JOIN pg_class c ON c.oid = p.partrelid
  WHERE p.partrelid = parent
    AND c.relnamespace = 'public'::regnamespace
    AND NOT c.relispartition
    AND p.partstrat = 'r';
  IF parent_name IS NULL THEN
    RAISE EXCEPTION 'drop_closed_partition: % is not a range-partitioned table in schema public', parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT (parent_name = ANY (archivable_streams())) THEN
    RAISE EXCEPTION 'drop_closed_partition: % is not an archivable stream', parent_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF end_ts > (now() - interval '7 days')::date THEN
    RAISE EXCEPTION 'drop_closed_partition: % has not been closed for 7 days', at_month
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  part_name := format('%s_%s', parent_name, to_char(start_ts, 'YYYYMM'));
  -- The same lock ensure_monthly_partition takes, so a creation and a drop of one partition never interleave.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_monthly_partition'), hashtext(part_name));

  part := to_regclass(format('public.%I', part_name));
  IF part IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = part AND i.inhparent = parent) THEN
    RAISE EXCEPTION 'drop_closed_partition: % is not a partition of %', part_name, parent_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (SELECT pg_get_expr(c.relpartbound, c.oid) FROM pg_class c WHERE c.oid = part) = 'DEFAULT' THEN
    RAISE EXCEPTION 'drop_closed_partition: refusing to drop the default partition %', part_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  EXECUTE format('ALTER TABLE public.%I DETACH PARTITION public.%I', parent_name, part_name);
  EXECUTE format('DROP TABLE public.%I', part_name);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION drop_closed_partition(regclass, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drop_closed_partition(regclass, date) TO crm_worker;

COMMENT ON FUNCTION drop_closed_partition(regclass, date) IS
  'Detaches and drops the closed monthly partition of an archivable stream. Caller must have archived and verified it first. See 20261218090000.';
