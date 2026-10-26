-- 2035_messages_autovacuum
-- Why this migration exists (not what it does — the SQL says that):
--
-- Sheet 3 D-08. A message row is written once and, for an outgoing message, updated up to three more times (queued -> sent -> delivered ->
-- read). status is in the predicate of the partial index idx_messages_queued, which the queued-message recovery job relies on, so none of
-- those updates can be HOT: each one leaves a dead row version in the table and a dead entry in every one of the 12 indexes.
--
-- With the server default (vacuum after 20 % of the rows changed, 50 + 0.2 x rows) a partition sits at the edge of the 20 % bloat target
-- before autovacuum even starts. Measured on a copy of messages with this update pattern (tools/db-bloat/bench.sql, 200k rows, vacuum run
-- by the same rule autovacuum uses): table bloat 19.7 % at the default and 5.3 % when vacuuming after 2 % changed, in 6x as many, much
-- smaller vacuums. A partitioned parent cannot carry storage options, so they go on each partition, and ensure_monthly_partition gives
-- them to every month it creates from now on.
--
-- Index bloat does not move with this setting (about 30 % in both runs): a B-tree page is only reused when it empties, so a closed month
-- keeps its half-empty pages until the index is rebuilt. That is handled by REINDEX CONCURRENTLY on closed months (docs/performance/db/
-- message-bloat-and-archival.md), which cannot run inside a migration.
--
-- Only messages: the other message tables were not measured. conversations already has its own setting (20270323090200).
-- Reversible, per partition: ALTER TABLE <partition> RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor).
DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN
    SELECT i.inhrelid::regclass FROM pg_inherits i WHERE i.inhparent = 'public.messages'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE %s SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)', part);
  END LOOP;
END $$;

-- ensure_monthly_partition as in 20261001110100, plus the storage options for messages. Owner, grants and comment carry over.
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
    IF parent_name = 'messages' THEN
      EXECUTE format(
        'ALTER TABLE public.%I SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)', part_name);
    END IF;
  END IF;
END $$;
