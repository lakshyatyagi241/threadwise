-- 20270204090100_retention_default_days_fn
-- The retention dashboard now covers every sweep that deletes data, including the platform default recording window of a workspace that
-- never chose its own. A workspace reads its recordings through its own tenant session, which cannot read the privileged-only
-- data_retention_policies table, so the one number it needs (the live days of one item) is exposed through this function and nothing else.
--
-- Returns the saved live days of the item, or p_fallback when no policy is saved. Reads one column of one row; takes no tenant input
-- beyond the item name; raises the privileged flag only for its own statement and restores it.

CREATE OR REPLACE FUNCTION retention_live_days(p_item text, p_fallback integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
  v integer;
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  SELECT live_days INTO v FROM data_retention_policies WHERE item = p_item;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
  RETURN coalesce(v, p_fallback);
END;
$$;

REVOKE ALL ON FUNCTION retention_live_days(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_live_days(text, integer) TO crm_app, crm_worker;
