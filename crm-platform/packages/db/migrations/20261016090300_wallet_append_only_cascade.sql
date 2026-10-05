-- wallet: an append-only trail still lets its parents be deleted.
-- Why this migration exists: the append-only triggers of 20261016090000 refused every DELETE that was not privileged, which also
-- refused the DELETE that ON DELETE CASCADE issues when a workspace is removed (and the UPDATE that ON DELETE SET NULL issues when an
-- operator or user is removed). A foreign key's action runs as a trigger itself, so the row trigger it fires sits one level deeper:
-- `pg_trigger_depth() > 1` tells "the database is applying a foreign key" from "a statement someone typed", which is at depth 1.
-- A direct edit or delete is still refused; deleting a workspace or a person still works.

CREATE OR REPLACE FUNCTION wallet_transactions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_is_privileged() OR pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'wallet_transactions is append-only: a posted entry cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'user_id' - 'operator_id' - 'updated_at' - 'row_version')
     IS NOT DISTINCT FROM (to_jsonb(OLD) - 'user_id' - 'operator_id' - 'updated_at' - 'row_version')
     AND (NEW.user_id IS NULL OR NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
     AND (NEW.operator_id IS NULL OR NEW.operator_id IS NOT DISTINCT FROM OLD.operator_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_transactions is append-only: a posted entry cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION wallet_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR (TG_OP = 'DELETE' AND app_is_privileged()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;
