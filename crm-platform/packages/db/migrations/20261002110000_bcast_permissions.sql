-- bcast: capability keys for WhatsApp broadcasts.
-- Why this migration exists (WD-BCAST-009): WaDesk gated /broadcasts on one workspace-role check (owner or admin).
-- Here the screen and the create action are separate keys so a workspace can hand them out apart. Later features
-- (delete, retry, export) add their own keys in their own migrations.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('bcast.broadcasts.read',   'View broadcasts',   'broadcasts', false),
  ('bcast.broadcasts.create', 'Create broadcasts', 'broadcasts', false)
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
    ('bcast.broadcasts.read'),
    ('bcast.broadcasts.create')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
