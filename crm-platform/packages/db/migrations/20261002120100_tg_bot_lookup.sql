-- tg: resolve a Telegram webhook routing token to its organization and bot (TW-TG-003).
--
-- Why this exists: POST /v2/telegram/inbound/<token> is public (Telegram calls it), so there is no tenant yet when the token
-- arrives, and the row that names the tenant is itself behind row-level security. Lifting RLS in application code for a
-- public route is exactly what the tenancy rules forbid, so the lookup is a SECURITY DEFINER function that returns two ids
-- for one token and nothing else (no token, no secret). After it answers, everything runs under the normal tenant context.

CREATE OR REPLACE FUNCTION tg_bot_lookup(p_token text)
RETURNS TABLE (bot_org_id bigint, bot_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT b.org_id, b.id FROM telegram_bots b WHERE b.webhook_token = p_token;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION tg_bot_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION tg_bot_lookup(text) TO crm_app_user;
  END IF;
END
$$;
