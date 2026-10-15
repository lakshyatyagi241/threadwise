-- wfl: public-lookup and global-uniqueness functions for wa_chat_links (docs/threadwise-port/inventory/forms-links-groups.md
-- TW-WFL-014, TW-WFL-017). The short-link namespace (`/l/{slug}`) is global across every workspace, same as Reference's, but
-- `wa_chat_links` is forced-RLS on `org_id`: a plain SELECT under a tenant's own session can only see its own org's rows, which
-- breaks both true global slug uniqueness and the public (no-tenant) redirect. These SECURITY DEFINER functions are the same
-- pattern as `web_form_lookup` (forms-builder) and `lead_source_lookup`: they read only what each caller needs, never the full row.

-- The public redirect's one read: enough to decide 404 / 410 / redirect and bump the counter by id afterward.
CREATE OR REPLACE FUNCTION wa_chat_link_lookup(p_slug text)
RETURNS TABLE (
  route_org_id bigint,
  route_id bigint,
  route_country_code text,
  route_phone_number text,
  route_welcome_message text,
  route_status text,
  route_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT l.org_id, l.id, l.country_code, l.phone_number, l.welcome_message, l.status, l.expires_at
    FROM wa_chat_links l
    WHERE l.slug = p_slug
    LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

-- Atomic click bump by internal id, callable with no tenant context (the public redirect has none).
CREATE OR REPLACE FUNCTION wa_chat_link_record_click(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  UPDATE wa_chat_links SET click_count = click_count + 1, last_clicked_at = now() WHERE id = p_id;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

-- Global slug uniqueness check for create/update/duplicate, called from inside an authenticated tenant transaction
-- (RLS would otherwise hide a collision with another workspace's link).
CREATE OR REPLACE FUNCTION wa_chat_link_slug_taken(p_slug text, p_exclude_id bigint DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
  taken boolean;
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  SELECT EXISTS (
    SELECT 1 FROM wa_chat_links WHERE slug = p_slug AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  ) INTO taken;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
  RETURN taken;
END;
$$;

REVOKE ALL ON FUNCTION wa_chat_link_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wa_chat_link_record_click(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION wa_chat_link_slug_taken(text, bigint) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION wa_chat_link_lookup(text) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION wa_chat_link_record_click(bigint) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION wa_chat_link_slug_taken(text, bigint) TO crm_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION wa_chat_link_lookup(text) TO crm_worker_user;
    GRANT EXECUTE ON FUNCTION wa_chat_link_record_click(bigint) TO crm_worker_user;
    GRANT EXECUTE ON FUNCTION wa_chat_link_slug_taken(text, bigint) TO crm_worker_user;
  END IF;
END
$$;
