-- bcast: capability key for resuming a paused broadcast (WD-BCAST-022 port requirement).
-- WaDesk's pause (a dropped socket, the daily cap) never reached its database and nothing resumed the run; here a paused
-- broadcast can be resumed by hand, and the worker resumes the ones that can resume on their own.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('bcast.broadcasts.resume', 'Resume paused broadcasts', 'broadcasts', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'bcast.broadcasts.resume', 'allow', 'all'
  FROM roles r
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
