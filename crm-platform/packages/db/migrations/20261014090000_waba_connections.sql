-- waba: connected WhatsApp numbers (TW-WABA-004..020, 029..031).
--
-- No new table: a connected number is a `wa_provider_configs` row with provider = 'waba' (credentials AES-GCM in
-- credentials_json, ids and Meta's health fields in meta_json). This migration adds what connecting and routing need:
--
--  1. A Meta phone number belongs to ONE live workspace. Reference let two workspaces connect the same number, which makes inbound
--     routing ambiguous (the webhook names a phone, not a tenant). A disconnected number releases the claim.
--  2. A lookup by WABA id for the webhook receiver and the health checks.
--  3. waba_route_lookup(): the public webhook arrives with a phone number id and no tenant. Like bcast_receipt_lookup it is a
--     SECURITY DEFINER function returning only ids, because lifting row-level security in application code is not allowed.
--  4. Capability keys. Reference gated every connect route on one workspace-role check (admin); here reading the numbers, connecting
--     them and managing them are separate keys, all given to the locked Admin preset.

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_provider_configs_waba_phone
  ON wa_provider_configs ((meta_json ->> 'phone_number_id'))
  WHERE provider = 'waba' AND status <> 'disconnected' AND meta_json ? 'phone_number_id';

CREATE INDEX IF NOT EXISTS idx_wa_provider_configs_waba_id
  ON wa_provider_configs ((meta_json ->> 'waba_id'))
  WHERE provider = 'waba';

CREATE OR REPLACE FUNCTION waba_route_lookup(p_phone_number_id text, p_waba_id text)
RETURNS TABLE (route_org_id bigint, route_config_id bigint, route_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.id, c.status
    FROM wa_provider_configs c
    WHERE c.provider = 'waba'
      AND (
        (p_phone_number_id IS NOT NULL AND c.meta_json ->> 'phone_number_id' = p_phone_number_id)
        OR (p_phone_number_id IS NULL AND p_waba_id IS NOT NULL AND c.meta_json ->> 'waba_id' = p_waba_id)
      )
    -- A live number beats a disconnected one that kept its ids; then the newest connection.
    ORDER BY (c.status <> 'disconnected') DESC, c.id DESC
    LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION waba_route_lookup(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION waba_route_lookup(text, text) TO crm_app_user;
  END IF;
END
$$;

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('waba.numbers.read',    'View connected WhatsApp numbers',                  'whatsapp', false),
  ('waba.numbers.connect', 'Connect WhatsApp Business numbers',                'whatsapp', false),
  ('waba.numbers.manage',  'Manage WhatsApp numbers (primary, token, disconnect, remove)', 'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- keys by unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('waba.numbers.read'),
    ('waba.numbers.connect'),
    ('waba.numbers.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
