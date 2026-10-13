-- sms: the send-only SMS channel (TW-SMS-001 to 008, 022, 025).
--
-- Why this migration exists: an SMS sender is a `wa_provider_configs` row with provider = 'sms' (as in Reference, and the broadcast
-- and campaign sender directories already read it), so there is no sender table to add. Three things the shared table lacks:
--
--  1. One sender per From value per workspace. Reference only enforced it in application code; "+1 737..." and "1737..." stay two
--     different values on purpose (TW-SMS-002 rule 5), so the key is the value as typed.
--  2. Two capability keys: reading the senders, and connecting / switching / removing them.
--  3. A routing lookup for the MSG91 delivery-report URL. MSG91 reports to one address configured by hand in its panel and sends no
--     signature, so the address carries a per-sender secret (meta_json.dlr_secret). The report arrives with no tenant, and this
--     SECURITY DEFINER function says which sender the secret belongs to and nothing else, for the same reason as
--     bcast_receipt_lookup: row-level security is never lifted in application code. Twilio reports are routed by message id
--     through bcast_receipt_lookup / camp_receipt_lookup and proved by Twilio's own request signature.

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_provider_configs_sms_from
  ON wa_provider_configs (org_id, phone_number)
  WHERE provider = 'sms';

CREATE INDEX IF NOT EXISTS idx_wa_provider_configs_sms_dlr_secret
  ON wa_provider_configs ((meta_json ->> 'dlr_secret'))
  WHERE provider = 'sms';

CREATE OR REPLACE FUNCTION sms_sender_by_dlr_secret(p_secret text)
RETURNS TABLE (sender_org_id bigint, sender_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.id
    FROM wa_provider_configs c
    WHERE c.provider = 'sms' AND (c.meta_json ->> 'dlr_secret') = p_secret AND p_secret <> ''
    LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION sms_sender_by_dlr_secret(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION sms_sender_by_dlr_secret(text) TO crm_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION sms_sender_by_dlr_secret(text) TO crm_worker_user;
  END IF;
END
$$;

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('sms.senders.read',   'View SMS senders',                       'sms', false),
  ('sms.senders.manage', 'Connect, switch and remove SMS senders', 'sms', false)
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
    ('sms.senders.read'),
    ('sms.senders.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
