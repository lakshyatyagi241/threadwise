-- bcast: resolve a tracked-link token to its organization (TW-BCAST-018).
--
-- Why this exists: GET /r/<token> is public, so there is no tenant yet when the token arrives, and the row that names the
-- tenant is itself behind row-level security. Lifting RLS in application code for a public route is exactly what the tenancy
-- rules forbid, so the lookup is a SECURITY DEFINER function that returns four columns for one token and nothing else.
-- After it answers, the click is recorded under the normal tenant context.

CREATE OR REPLACE FUNCTION bcast_link_lookup(p_token text)
RETURNS TABLE (link_id bigint, link_org_id bigint, original_url text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT l.id, l.org_id, l.original_url, l.expires_at FROM wa_link_clicks l WHERE l.token = p_token;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION bcast_link_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION bcast_link_lookup(text) TO crm_app_user;
  END IF;
END
$$;
