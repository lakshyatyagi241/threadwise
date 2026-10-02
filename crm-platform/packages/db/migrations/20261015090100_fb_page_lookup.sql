-- fb: resolve a Meta Page id to every organization that connected it (WD-FB-006).
--
-- Why this exists: POST /v2/facebook/webhook is public (Meta calls it), so there is no tenant when an event arrives, and the row that
-- names the tenant is itself behind row-level security. Lifting RLS in application code for a public route is exactly what the
-- tenancy rules forbid, so the lookup is a SECURITY DEFINER function that returns two ids per connected Page and nothing else (no
-- token). The same Page can be connected in more than one organization (unique key is org + page id), so it returns every one:
-- Meta sends one webhook per Page and each organization must receive it. After it answers, everything runs under the normal
-- tenant context.

CREATE OR REPLACE FUNCTION fb_page_lookup(p_page_id text)
RETURNS TABLE (page_org_id bigint, page_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT p.org_id, p.id FROM facebook_pages p WHERE p.page_id = p_page_id AND p.status = 'connected' ORDER BY p.org_id, p.id;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION fb_page_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION fb_page_lookup(text) TO crm_app_user;
  END IF;
END
$$;
