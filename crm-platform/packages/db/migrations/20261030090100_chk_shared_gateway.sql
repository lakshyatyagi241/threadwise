-- chk: one workspace payment gateway for the store checkout and Sales invoices (owner decision 2026-10-05).
-- Why this migration exists:
--  * `wa_merchant_gateways.storefront_id = 0` means "the whole workspace" (WaDesk), but the table carried a foreign key to
--    wa_storefronts, so a workspace row (id 0) could never be inserted. The key goes; a trigger removes a shop's overrides when the
--    shop is deleted, which is what the key's RESTRICT was protecting against orphans for.
--  * a default flag: with several gateways configured in one scope, the one flagged is what a checkout or an invoice uses.
--  * the webhook of a gateway is addressed by the row's uuid, so the provider's call names the workspace and the shop (and so the right
--    secret) without trusting anything in the body. The lookup is a SECURITY DEFINER function like the other public lookups.

ALTER TABLE wa_merchant_gateways DROP CONSTRAINT IF EXISTS fk_wa_merchant_gateways_storefront_id;

ALTER TABLE wa_merchant_gateways
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_wa_merchant_gateways_scope CHECK (storefront_id >= 0),
  ADD CONSTRAINT chk_wa_merchant_gateways_mode CHECK (mode IN ('live', 'test')),
  ADD CONSTRAINT chk_wa_merchant_gateways_slug CHECK (slug ~ '^[a-z0-9_-]{1,64}$');

-- At most one default per scope (the workspace, or one shop).
CREATE UNIQUE INDEX uq_wa_merchant_gateways_default
  ON wa_merchant_gateways (org_id, storefront_id) WHERE is_default;

CREATE OR REPLACE FUNCTION wa_storefronts_drop_gateway_overrides()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM wa_merchant_gateways WHERE org_id = OLD.org_id AND storefront_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_wa_storefronts_drop_gateway_overrides
  AFTER DELETE ON wa_storefronts
  FOR EACH ROW EXECUTE FUNCTION wa_storefronts_drop_gateway_overrides();

CREATE OR REPLACE FUNCTION store_gateway_lookup(p_uuid uuid)
RETURNS TABLE (gateway_id bigint, gateway_org_id bigint, gateway_storefront_id bigint, gateway_slug text, gateway_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT g.id, g.org_id, g.storefront_id, g.slug, g.active FROM wa_merchant_gateways g WHERE g.uuid = p_uuid;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION store_gateway_lookup(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION store_gateway_lookup(uuid) TO crm_app_user;
  END IF;
END
$$;
