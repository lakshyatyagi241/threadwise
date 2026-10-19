-- 20270202090200_sec_ecom_webhook_secret_hash
-- Encryption audit E2: the Shopify / WooCommerce `webhook_secret` was plaintext. It is three things at once: the last path segment of the webhook
-- URL shown to the store owner, the key ecom_store_lookup() finds the workspace by (a public webhook has no tenant yet), and for WooCommerce the
-- HMAC key given to the plugin. So it is split: a SHA-256 hash (the lookup) and a sealed copy (the URL and the key), both beside the old column.
--
-- Expand step only (blue-green):
--  * two nullable columns per table; `webhook_secret` becomes nullable (the live slot still inserts it, nothing it does changes);
--  * a unique index on the hash, like the one the 20261116090000 migration put on the plaintext (that one stays);
--  * a BEFORE INSERT/UPDATE trigger fills the hash when a writer sets only the plaintext (the live slot), so a store connected during the
--    switch is already findable by hash;
--  * ecom_store_lookup() keeps its name, arguments and result, and matches the hash as well as the old column, so a webhook URL a store
--    already holds keeps working at every step. An empty secret matches nothing.
-- Nothing is blanked here. After the release that writes the sealed copy is the only one running: set SECRETS_LEGACY_PLAINTEXT_MIRROR=off,
-- run `seal-plaintext-secrets.cli.ts` (fills hash + sealed copy of old rows), then with `--scrub` (sets `webhook_secret` to NULL).
ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret_hash text,
  ADD COLUMN IF NOT EXISTS webhook_secret_enc text,
  ALTER COLUMN webhook_secret DROP NOT NULL;
ALTER TABLE woocommerce_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret_hash text,
  ADD COLUMN IF NOT EXISTS webhook_secret_enc text,
  ALTER COLUMN webhook_secret DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_integrations_webhook_secret_hash
  ON shopify_integrations (webhook_secret_hash) WHERE webhook_secret_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_woocommerce_integrations_webhook_secret_hash
  ON woocommerce_integrations (webhook_secret_hash) WHERE webhook_secret_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION ecom_fill_webhook_secret_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only routable secrets (16 characters or more; the receiver refuses shorter ones) get a hash, like the plaintext unique index, so a short
  -- fixture secret or a duplicate that index tolerates cannot make this one fail.
  IF NEW.webhook_secret IS NOT NULL AND length(NEW.webhook_secret) >= 16
     AND (NEW.webhook_secret_hash IS NULL
          OR (TG_OP = 'UPDATE' AND NEW.webhook_secret IS DISTINCT FROM OLD.webhook_secret
              AND NEW.webhook_secret_hash IS NOT DISTINCT FROM OLD.webhook_secret_hash)) THEN
    NEW.webhook_secret_hash := encode(sha256(convert_to(NEW.webhook_secret, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_shopify_integrations_webhook_secret_hash ON shopify_integrations;
CREATE TRIGGER trg_shopify_integrations_webhook_secret_hash BEFORE INSERT OR UPDATE ON shopify_integrations
  FOR EACH ROW EXECUTE FUNCTION ecom_fill_webhook_secret_hash();
DROP TRIGGER IF EXISTS trg_woocommerce_integrations_webhook_secret_hash ON woocommerce_integrations;
CREATE TRIGGER trg_woocommerce_integrations_webhook_secret_hash BEFORE INSERT OR UPDATE ON woocommerce_integrations
  FOR EACH ROW EXECUTE FUNCTION ecom_fill_webhook_secret_hash();

CREATE OR REPLACE FUNCTION ecom_store_lookup(p_kind text, p_secret text)
RETURNS TABLE (store_org_id bigint, store_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
  h text := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  IF p_secret <> '' THEN
    IF p_kind = 'shopify' THEN
      RETURN QUERY SELECT s.org_id, s.id FROM shopify_integrations s
        WHERE s.webhook_secret_hash = h OR s.webhook_secret = p_secret ORDER BY s.org_id, s.id LIMIT 1;
    ELSIF p_kind = 'woocommerce' THEN
      RETURN QUERY SELECT w.org_id, w.id FROM woocommerce_integrations w
        WHERE w.webhook_secret_hash = h OR w.webhook_secret = p_secret ORDER BY w.org_id, w.id LIMIT 1;
    END IF;
  END IF;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;
