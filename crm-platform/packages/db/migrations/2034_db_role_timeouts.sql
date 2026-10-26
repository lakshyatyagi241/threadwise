-- 2034_db_role_timeouts
-- Why this migration exists (not what it does — the SQL says that):
--
-- Sheet 3 D-13. The app sets statement_timeout, lock_timeout and idle_in_transaction_session_timeout on every connection it opens (the
-- DB_*_TIMEOUT_MS settings, which win over anything here), but a connection that does not come from the app pools, such as a script, a
-- psql session or a future service logging in as these roles, had no limit at all: one query waiting on a lock, or one forgotten
-- transaction, could hold a connection and its locks for ever. These role defaults are the backstop for those.
--
-- crm_app_user serves the API: 5 s lock wait, 30 s idle inside a transaction. crm_worker_user runs the outbox drain, which claims rows
-- in one transaction and runs every handler before recording the result on that connection, so it legitimately sits idle inside the
-- transaction for as long as the handlers take: 15 s lock wait, 300 s idle. Both keep the 15 s statement limit the app uses.
--
-- A role that does not exist is skipped, and so is a role this migration's user may not alter (insufficient_privilege): the app-side
-- settings still apply, and the notice says so. Reversible, one setting per statement: ALTER ROLE <role> RESET statement_timeout;
-- ALTER ROLE <role> RESET lock_timeout; ALTER ROLE <role> RESET idle_in_transaction_session_timeout.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('crm_app_user', '5s', '30s'),
      ('crm_worker_user', '15s', '300s')
    ) AS t(role_name, lock_t, idle_t)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name) THEN
      BEGIN
        EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.role_name, '15s');
        EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', r.role_name, r.lock_t);
        EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', r.role_name, r.idle_t);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'role % not altered (insufficient privilege): the app-side timeouts still apply', r.role_name;
      END;
    END IF;
  END LOOP;
END
$$;
