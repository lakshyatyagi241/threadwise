-- camp: capability key for the broadcast wizard's test send.
-- Why this migration exists: a test send is a real WhatsApp message that costs credits, so it is its own key instead of riding on
-- `camp.campaigns.create`; a workspace can let someone build broadcasts but not message numbers while building. Creating, launching
-- and controlling a wizard broadcast reuse camp.campaigns.create / read / control.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('camp.campaigns.test', 'Send test messages from the broadcast wizard', 'campaigns', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the key by unlocking,
-- granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'camp.campaigns.test', 'allow', 'all'
  FROM roles r
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
