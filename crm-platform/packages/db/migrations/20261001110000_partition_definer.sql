-- 20261001110000_partition_definer
-- The partition-maintenance job connects as crm_app_user, which owns no table and
-- has no CREATE on schema public. CREATE TABLE ... PARTITION OF needs both, so as
-- 0001 defined it ensure_monthly_partition() failed with "permission denied for
-- schema public" for the runtime role: only the partitions a migration bootstrapped
-- ever existed, and rows would have started landing in the _default partitions
-- once those ran out. See ADR-0021.
--
-- The function now runs with its owner's rights (the migration role, which owns
-- every partitioned parent) so the worker does not need DDL rights of its own.
-- That moves the control from "the caller may not create tables" to "the caller
-- may only ask for this one thing", so the function checks its own arguments:
--
--   * search_path is pinned. Without it a caller could put its own schema first
--     and make the owner's rights resolve names to objects the caller made.
--   * the parent must be a RANGE-partitioned table in public that is not itself
--     a partition. Anything else (a contacts-style table, a table in another
--     schema, a hash bucket) is refused, so this cannot be used to create
--     arbitrary tables.
--   * the month must be within a window around now. Maintenance asks for at most
--     three months ahead; the cap stops a runaway caller from creating partitions
--     without limit. The lower bound leaves room for a legacy-data backfill.
--   * a transaction-scoped advisory lock per partition name serialises concurrent
--     callers (several workers booting together). Check-then-create alone lets two
--     of them both pass the check and one die on a unique violation in pg_class.
--
-- EXECUTE moves from PUBLIC (the default for a new function) to the two runtime
-- groups. The signature is unchanged, so 0006 and the stream migrations that
-- call it keep working.

CREATE OR REPLACE FUNCTION ensure_monthly_partition(parent regclass, at_month date)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  parent_name text;
  start_ts    date := date_trunc('month', at_month)::date;
  end_ts      date := (date_trunc('month', at_month) + interval '1 month')::date;
  part_name   text;
BEGIN
  SELECT c.relname INTO parent_name
  FROM pg_partitioned_table p
  JOIN pg_class c ON c.oid = p.partrelid
  WHERE p.partrelid = parent
    AND c.relnamespace = 'public'::regnamespace
    AND NOT c.relispartition
    AND p.partstrat = 'r';
  IF parent_name IS NULL THEN
    RAISE EXCEPTION 'ensure_monthly_partition: % is not a range-partitioned table in schema public', parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF start_ts < (date_trunc('month', now()) - interval '10 years')::date
     OR start_ts > (date_trunc('month', now()) + interval '1 year')::date THEN
    RAISE EXCEPTION 'ensure_monthly_partition: % is outside the allowed window (10 years back, 1 year ahead)', at_month
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  part_name := format('%s_%s', parent_name, to_char(start_ts, 'YYYYMM'));
  PERFORM pg_advisory_xact_lock(hashtext('ensure_monthly_partition'), hashtext(part_name));

  IF to_regclass(format('public.%I', part_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
      part_name, parent_name, start_ts, end_ts
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION ensure_monthly_partition(regclass, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_monthly_partition(regclass, date) TO crm_app, crm_worker;

COMMENT ON FUNCTION ensure_monthly_partition(regclass, date) IS
  'Creates the monthly RANGE partition of a public partitioned table. SECURITY DEFINER so the runtime role can call it without owning the table; validates its arguments instead. ADR-0021.';
