-- ig: capability key for running an engine flow on an Instagram conversation (TW-IG-012).
-- Reference let anyone who could reply start a flow (a policy on the conversation). Starting a flow sends messages on the account's
-- behalf and can run for a long time, so it is its own key rather than a side effect of reading the inbox.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('ig.flows.run', 'Run Instagram flows on a conversation', 'instagram', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- key by unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'ig.flows.run', 'allow', 'all'
  FROM roles r
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
