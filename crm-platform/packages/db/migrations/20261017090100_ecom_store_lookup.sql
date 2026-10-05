-- ecom: resolve a webhook address to the store it belongs to (TW-ECOM-008, 027).
--
-- Why this exists: a store's webhooks (`POST /v2/shopify/webhook/{secret}`, `POST /v2/woocommerce/webhook/{secret}`) are public, so
-- there is no tenant when one arrives, and the row that names the tenant is itself behind row-level security. Lifting RLS in
-- application code for a public route is exactly what the tenancy rules forbid, so the lookup is a SECURITY DEFINER function that
-- returns two ids and nothing else (no token, no key). The secret is 40 random characters chosen at connect time; it only picks the
-- store, because every delivery is also signed. After it answers, everything runs under the normal tenant context.

CREATE OR REPLACE FUNCTION ecom_store_lookup(p_kind text, p_secret text)
RETURNS TABLE (store_org_id bigint, store_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  IF p_kind = 'shopify' THEN
    RETURN QUERY SELECT s.org_id, s.id FROM shopify_integrations s WHERE s.webhook_secret = p_secret ORDER BY s.org_id, s.id LIMIT 1;
  ELSIF p_kind = 'woocommerce' THEN
    RETURN QUERY SELECT w.org_id, w.id FROM woocommerce_integrations w WHERE w.webhook_secret = p_secret ORDER BY w.org_id, w.id LIMIT 1;
  END IF;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION ecom_store_lookup(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION ecom_store_lookup(text, text) TO crm_app_user;
  END IF;
END
$$;
