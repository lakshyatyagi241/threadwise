-- 0001_extensions
-- Extensions and the tenant-context plumbing that every later migration
-- depends on. Nothing here is tenant-specific.

CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email columns
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name/dedup matching
-- pgvector ships in the dev image; guarded so a plain postgres:16 still works.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vector extension unavailable — ai_embeddings will need it later';
END $$;

-- ---------------------------------------------------------------------------
-- Tenant context
--
-- Every request opens a transaction and calls set_config('app.org_id', ..., true)
-- (transaction-local). RLS policies read it back through these functions.
-- `true` as the second argument to current_setting means "return NULL instead
-- of erroring when unset" — an unset context must fail closed, not blow up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_org_id() RETURNS bigint
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::bigint $$;

CREATE OR REPLACE FUNCTION current_actor_id() RETURNS bigint
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::bigint $$;

-- Escape hatch for background workers that legitimately span tenants (outbox
-- drain, billing roll-up, partition maintenance). Set ONLY from the worker
-- bootstrap — never from an HTTP request path. See ADR-0005.
CREATE OR REPLACE FUNCTION app_is_privileged() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.privileged', true), 'off') = 'on' $$;

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

-- Maintains updated_at and the optimistic-lock counter. The application never
-- writes row_version itself; it only asserts the value it read:
--   UPDATE contacts SET ... WHERE org_id=$1 AND id=$2 AND row_version=$3
-- 0 rows affected => someone else won the race => 409 ROW_VERSION_CONFLICT.
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END $$;

-- Creates the monthly RANGE partition covering `at_month` if it is missing.
-- Called by the partition-maintenance job, which runs a few months ahead so a
-- missing partition can never reject a live insert.
CREATE OR REPLACE FUNCTION ensure_monthly_partition(parent regclass, at_month date)
  RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  start_ts   date := date_trunc('month', at_month)::date;
  end_ts     date := (date_trunc('month', at_month) + interval '1 month')::date;
  part_name  text := format('%s_%s', parent::text, to_char(start_ts, 'YYYYMM'));
BEGIN
  IF to_regclass(part_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
      part_name, parent::text, start_ts, end_ts
    );
  END IF;
END $$;
