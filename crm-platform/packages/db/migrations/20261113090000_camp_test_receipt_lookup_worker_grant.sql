-- The WABA ingest processor runs in the worker (crm_worker_user) and calls camp_test_receipt_lookup for every delivery report.
-- The original migration granted EXECUTE to crm_app_user only, so every status webhook failed with 42501 and landed in the
-- waba-ingest failed set. Same grant pattern as chat_channel_by_external.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION camp_test_receipt_lookup(text) TO crm_worker_user;
  END IF;
END
$$;
