-- camp: capability keys for campaigns.
-- Why this migration exists (WD-CAMP-001 to 024): WaDesk gated every campaign route on the workspace admin role and the plan flag
-- `campaign`. Here the list and the detail, creating, editing, running (cancel, resume, send now, resend), deleting and exporting
-- are separate keys so a workspace can hand them out apart.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('camp.campaigns.read',    'View campaigns',                       'campaigns', false),
  ('camp.campaigns.create',  'Create campaigns',                     'campaigns', false),
  ('camp.campaigns.update',  'Edit campaigns',                       'campaigns', false),
  ('camp.campaigns.control', 'Cancel, resume, send now and resend campaigns', 'campaigns', false),
  ('camp.campaigns.delete',  'Delete campaigns',                     'campaigns', false),
  ('camp.campaigns.export',  'Export campaign recipients',           'campaigns', false)
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
    ('camp.campaigns.read'),
    ('camp.campaigns.create'),
    ('camp.campaigns.update'),
    ('camp.campaigns.control'),
    ('camp.campaigns.delete'),
    ('camp.campaigns.export')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
