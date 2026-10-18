-- worker_lookup_grants_sweep
-- 20261021100000_worker_lookup_grants gave crm_worker_user EXECUTE on the SECURITY DEFINER lookups that existed that day. Functions added
-- since (sched_receipt_lookup, 20261122090000, and others) granted crm_app_user only, so on production, where the worker logs in as
-- crm_worker_user, every WhatsApp ingest job that reaches them fails with "permission denied for function sched_receipt_lookup"
-- (2,000 failed waba-ingest jobs on the health page). Same sweep, same rule: only functions the app role is already trusted with.
-- Idempotent: a function the worker can already run is skipped, so it is safe to run again after the next lookup is added.

DO $$
DECLARE
  fn record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    RETURN;
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('crm_app_user', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('crm_worker_user', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_worker_user', fn.sig);
  END LOOP;
END
$$;
