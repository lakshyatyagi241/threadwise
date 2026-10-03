-- store: resolve a public shop address to its organization (WD-STORE-009, 021).
--
-- Why this exists: GET /s/<slug> and the shop's own domain are public, so there is no tenant yet when the request arrives, and
-- the row that names the tenant (wa_storefronts) is itself behind row-level security. Lifting RLS in application code for a
-- public route is exactly what the tenancy rules forbid, so each lookup is a SECURITY DEFINER function that returns the three
-- columns the caller needs for one slug or one host and nothing else. After it answers, every read and write runs under the
-- normal tenant context. Same pattern as bcast_link_lookup.

CREATE OR REPLACE FUNCTION store_public_lookup_slug(p_slug text)
RETURNS TABLE (storefront_id bigint, store_org_id bigint, enabled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT s.id, s.org_id, s.enabled FROM wa_storefronts s WHERE s.slug = p_slug;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

-- A verified custom domain only: an unverified one must not serve a shop.
CREATE OR REPLACE FUNCTION store_public_lookup_host(p_host text)
RETURNS TABLE (storefront_id bigint, store_org_id bigint, slug text, enabled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT s.id, s.org_id, s.slug, s.enabled
    FROM wa_storefronts s
    WHERE s.custom_domain = lower(p_host) AND s.custom_domain_verified;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

-- The payment webhook names the shop by id only (Razorpay notes carry it), so the signature secret lives behind this.
CREATE OR REPLACE FUNCTION store_public_lookup_id(p_storefront_id bigint)
RETURNS TABLE (storefront_id bigint, store_org_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT s.id, s.org_id FROM wa_storefronts s WHERE s.id = p_storefront_id;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION store_public_lookup_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_public_lookup_host(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_public_lookup_id(bigint) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION store_public_lookup_slug(text) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION store_public_lookup_host(text) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION store_public_lookup_id(bigint) TO crm_app_user;
  END IF;
END
$$;
