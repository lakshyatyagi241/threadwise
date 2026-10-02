-- bcast: capability keys for deleting, retrying and exporting broadcasts.
-- Why (TW-BCAST-037, 038, 040): Reference gated every one of these on the single owner-or-admin role check. Each is its own
-- key here so a workspace can hand them out apart; the locked Admin preset gets all three.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('bcast.broadcasts.delete', 'Delete broadcasts',                'broadcasts', false),
  ('bcast.broadcasts.retry',  'Retry failed broadcast recipients', 'broadcasts', false),
  ('bcast.broadcasts.export', 'Export broadcast recipients',       'broadcasts', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('bcast.broadcasts.delete'),
    ('bcast.broadcasts.retry'),
    ('bcast.broadcasts.export')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
