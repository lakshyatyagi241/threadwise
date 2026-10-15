-- audit_log is append-only.
--
-- Why: crm_app and crm_worker were granted UPDATE and DELETE on audit_log (0007), so a bug, or a stolen session that reaches the
-- query layer, could rewrite or erase the history that is meant to prove what happened. Other ledgers (wallet, payments) are
-- append-only by trigger; this one was not.
--
-- Rule enforced here, in the database, for every role including the table owner:
--   * UPDATE is never allowed. No code path updates an audit row.
--   * DELETE is allowed only inside a privileged transaction (app.privileged = 'on', see withPrivileged). The two legitimate
--     deleters run that way and are not reachable from an HTTP handler: the retention prune (auth maintenance,
--     audit_log_retention_days) and the workspace erasure (lifecycle.repository erase). Tenant requests never set it.
--
-- A trigger rather than REVOKE: grants are per table, so a revoke on the parent would not cover the partitions that
-- ensure_monthly_partition() creates later, while a row trigger on a partitioned parent is cloned to every partition, existing
-- and future. Dropping or detaching a whole partition is DDL, not a row delete, and stays available to the owner for retention.
--
-- Limit: a caller that can already run arbitrary SQL as the app role can set app.privileged itself, as with every RLS bypass in
-- this schema. This closes the application-bug and ordinary-session paths; the audit-log export plus the retention window are
-- the second line.

CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND app_is_privileged() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
