-- 20261001110100_partition_rls
-- Row-level security is enforced on the partitioned PARENT. A query that names a
-- partition directly skips the parent's policies and applies the partition's own,
-- and no partition had any. So `SELECT * FROM messages_202610`, run with the grants
-- crm_app gets by default, returned every tenant's rows. Nothing in the application
-- queries a partition by name, which is why it went unnoticed; but a query that
-- reaches the wrong relation should be filtered like the right one, not read
-- across tenants. (This is a guard against misdirected queries. It is not a barrier
-- against someone who can run arbitrary SQL as the app role: app_is_privileged()
-- reads a setting that role can set, on the parent as much as on a partition.
-- ADR-0002 already records that limit.)
--
-- Each partition now carries the same RLS flags and policies as its parent. The
-- parents all use the one tenant_isolation policy, so this is that policy again,
-- copied from pg_policy rather than retyped so a parent with a different policy
-- is mirrored exactly.
--
-- The alternative, revoking the app role's grants on partitions, was rejected in
-- ADR-0021: the only direct reader we need is the default-partition alert, and
-- default privileges would re-grant on every partition a later migration creates.
--
-- Also fixes the grants of the 0006 partitions (event_outbox, audit_log). They
-- were created before 0007 set default privileges, so crm_app could not read
-- them, which is what kept defaultPartitionCounts() from running as the app role.
-- Access through the parent never needed them.
--
-- ensure_monthly_partition() calls the helper for every partition it creates.
-- A migration that creates a _default partition by hand must call
-- inherit_partition_rls() on it, and schema-invariants.spec.ts fails if one does not.

-- Owner-only helper. Not SECURITY DEFINER and not granted to the app roles: it is
-- called by migrations, and by ensure_monthly_partition, which already runs as the
-- owner.
CREATE OR REPLACE FUNCTION inherit_partition_rls(part regclass)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
DECLARE
  parent_oid   oid;
  parent_rls   boolean;
  parent_force boolean;
  pol          record;
  roles        text;
BEGIN
  SELECT i.inhparent INTO parent_oid FROM pg_inherits i WHERE i.inhrelid = part;
  IF parent_oid IS NULL THEN
    RAISE EXCEPTION 'inherit_partition_rls: % is not a partition', part
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO parent_rls, parent_force
  FROM pg_class c WHERE c.oid = parent_oid;
  -- A parent without RLS is open on purpose; its partitions stay open too.
  IF NOT parent_rls THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part);
  IF parent_force THEN
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', part);
  END IF;

  FOR pol IN
    SELECT polname, polcmd, polpermissive, polroles,
           pg_get_expr(polqual, polrelid)      AS qual,
           pg_get_expr(polwithcheck, polrelid) AS chk
    FROM pg_policy WHERE polrelid = parent_oid
  LOOP
    IF pol.polroles = '{0}'::oid[] THEN
      roles := 'PUBLIC';
    ELSE
      SELECT string_agg(quote_ident(r.rolname), ', ') INTO roles
      FROM pg_roles r WHERE r.oid = ANY (pol.polroles);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol.polname, part);
    EXECUTE format(
      'CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s',
      pol.polname, part,
      CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                      WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
      roles,
      CASE WHEN pol.qual IS NULL THEN '' ELSE ' USING (' || pol.qual || ')' END,
      CASE WHEN pol.chk  IS NULL THEN '' ELSE ' WITH CHECK (' || pol.chk || ')' END
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION inherit_partition_rls(regclass) FROM PUBLIC;

-- Every partition that exists today.
DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE c.relkind IN ('r', 'p')
      AND c.relnamespace = 'public'::regnamespace
      AND parent.relnamespace = 'public'::regnamespace
      AND parent.relkind = 'p'
  LOOP
    PERFORM inherit_partition_rls(part);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO crm_app, crm_worker', part);
  END LOOP;
END $$;

-- ensure_monthly_partition as in 20261001110000, plus the call that gives each new
-- partition its parent's policies. Owner, grants and comment carry over.
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
    PERFORM inherit_partition_rls(format('public.%I', part_name)::regclass);
  END IF;
END $$;
