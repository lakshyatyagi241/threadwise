-- audit_log: one narrow UPDATE, for erasing a contact's personal values out of the audit trail.
--
-- Why: the audit row of a contact keeps the old and new values of the fields that changed (names, numbers), and the privacy
-- registry clears that `delta` when the person is erased (manifests/privacy.ts). 20261211090000 made audit_log append-only, which
-- refuses every UPDATE, so that erasure failed and every contact that had an audit row could not be deleted (500).
--
-- The rule stays in place for everything except this one shape: an UPDATE is allowed only when
--   * the transaction set the local setting app.audit_redact = 'on' (the erasure pipeline does it around its one UPDATE),
--   * the row is a contacts row (module = 'contacts'),
--   * the only column that changes is `delta`, and it becomes NULL.
-- Every other UPDATE is refused, and DELETE stays as it was (privileged transactions only). RLS still applies to the UPDATE, so it
-- can only touch rows of the caller's own workspace. The row (actor, action, time, record id) is never changed.
--
-- Same limit as the rest of the guard: code that already runs arbitrary SQL as the app role can set the setting itself.

CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND app_is_privileged() THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND current_setting('app.audit_redact', true) = 'on'
     AND OLD.module = 'contacts'
     AND NEW.delta IS NULL
     AND to_jsonb(NEW) - 'delta' = to_jsonb(OLD) - 'delta' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
