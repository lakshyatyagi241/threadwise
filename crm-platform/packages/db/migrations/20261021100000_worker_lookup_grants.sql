-- worker_lookup_grants
-- The tenant-routing lookups (waba_route_lookup, bcast_receipt_lookup, tg_bot_lookup, ...) are SECURITY DEFINER functions that a
-- queue job calls BEFORE any tenant is known, so the job cannot go through a tenant transaction. Each migration granted EXECUTE to
-- crm_app_user only. In development the worker connects as that same role and it works; in production the worker runs as
-- crm_worker_user (its own low-privilege login, so it can be limited independently) and every such job failed with
-- "permission denied for function ...". The first one noticed: inbound WhatsApp webhooks were acknowledged and then lost.
--
-- Give crm_worker_user EXECUTE on every SECURITY DEFINER function crm_app_user can execute. Not all functions: only the ones the app
-- role was already trusted with, so the worker gains no capability the API process did not already have.

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
