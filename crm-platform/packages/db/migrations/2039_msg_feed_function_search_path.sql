-- 2039_msg_feed_function_search_path
-- Why this migration exists (not what it does — the SQL says that):
--
-- pg_dump/pg_restore run with an empty search_path. The message-feed trigger functions (an_msg_event_insert and friends) call
-- an_msg_feed_cutover() and an_msg_feed_counted() unqualified, so loading `messages` data into a database that has the triggers
-- fails with "function an_msg_feed_cutover() does not exist". It surfaced on the PostgreSQL 16 -> 18 production move, where the
-- restore only worked with --disable-triggers.
--
-- Pin the search_path of every plpgsql function in public that has none, the same `public, pg_temp` the other functions here use.
-- SQL-language functions are left alone on purpose: a SET clause stops the planner inlining them (an_msg_feed_counted is IMMUTABLE
-- and used inside queries). Idempotent: functions that already carry a search_path are skipped.

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND l.lanname = 'plpgsql'
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END
$$;
