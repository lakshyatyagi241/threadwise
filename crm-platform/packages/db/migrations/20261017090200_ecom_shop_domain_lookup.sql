-- ecom: resolve a Shopify shop domain to its stores for the mandatory GDPR webhooks (TW-ECOM-022).
--
-- `POST /v2/shopify/compliance` is public and has no per-store secret; Shopify names the shop by domain. Like `ecom_store_lookup`, the
-- row that names the tenant sits behind row-level security, so the lookup is a SECURITY DEFINER function returning two ids only.
-- The caller proves itself with the app-level HMAC before this is ever called.

CREATE OR REPLACE FUNCTION ecom_shop_lookup(p_domain text)
RETURNS TABLE (store_org_id bigint, store_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY SELECT s.org_id, s.id FROM shopify_integrations s WHERE lower(s.store_url) = lower(p_domain) ORDER BY s.org_id, s.id;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION ecom_shop_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION ecom_shop_lookup(text) TO crm_app_user;
  END IF;
END
$$;
