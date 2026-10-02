-- appt: capability keys for booking types and appointments.
-- Why this migration exists (TW-APPT-001, D-02): Reference put every appointments route behind the admin workspace role and the plan flag and
-- nothing else. Here an appointment is a record like a task (record.appointments.*, with a record scope: `own` is "I am the host or I
-- created it", `team` adds the people on my teams, `all` is the workspace) and a booking type is configuration
-- (record.booking-types.*, no scope).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.booking-types.read',   'View booking types',                          'crm', false),
  ('record.booking-types.create', 'Create booking types',                        'crm', false),
  ('record.booking-types.update', 'Edit booking types, hours and overrides',     'crm', false),
  ('record.booking-types.delete', 'Delete booking types',                        'crm', false),
  ('record.appointments.read',    'View appointments',                           'crm', true),
  ('record.appointments.create',  'Book appointments',                           'crm', false),
  ('record.appointments.update',  'Edit, move, confirm, cancel and close appointments', 'crm', true),
  ('record.appointments.delete',  'Delete finished appointments',                'crm', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the tasks and deals migrations do. New organizations get every key in permission_defs
-- when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.booking-types.read'), ('record.booking-types.create'), ('record.booking-types.update'), ('record.booking-types.delete'),
    ('record.appointments.read'), ('record.appointments.create'), ('record.appointments.update'), ('record.appointments.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (named Agent by sign-up, Counsellor by the dev seed) sees the services and works the appointments
-- that are its own (it hosts them or booked them). A workspace widens that in its role editor.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.booking-types.read', 'all'),
    ('record.appointments.read', 'own'), ('record.appointments.create', 'all'), ('record.appointments.update', 'own')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
