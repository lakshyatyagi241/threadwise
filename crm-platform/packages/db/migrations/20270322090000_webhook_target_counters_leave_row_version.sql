-- 20270322090000_webhook_target_counters_leave_row_version
-- Why this migration exists (not what it does — the SQL says that):
-- The forwarder writes each target's delivery counters every few seconds. The shared touch_row() trigger bumped
-- row_version on every UPDATE, so an operator saving a target always sent a version a counter flush had already moved
-- past, and every edit failed with ROW_VERSION_CONFLICT ("modified by someone else"). Only a change to the target's own
-- settings is an edit, so only that bumps row_version now. The counters stay on the row (the list shows them).

DROP TRIGGER trg_webhook_forward_targets_touch ON webhook_forward_targets;

CREATE OR REPLACE FUNCTION touch_webhook_forward_target() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  -- Written by the forwarder on every delivery. They are not settings, so they never count as an edit.
  counters text[] := ARRAY['success_count', 'failure_count', 'last_status', 'last_error',
                           'last_success_at', 'last_failure_at'];
BEGIN
  IF to_jsonb(NEW) - counters - 'row_version' - 'updated_at'
     IS DISTINCT FROM
     to_jsonb(OLD) - counters - 'row_version' - 'updated_at' THEN
    NEW.updated_at := now();
    NEW.row_version := OLD.row_version + 1;
  ELSE
    NEW.updated_at := OLD.updated_at;
    NEW.row_version := OLD.row_version;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_webhook_forward_targets_touch BEFORE UPDATE ON webhook_forward_targets
  FOR EACH ROW EXECUTE FUNCTION touch_webhook_forward_target();
