-- wgt: capability keys for the website chatbot widget.
-- Why this migration exists (TW-WGT-027): Reference gated every widget admin route on one workspace-role check (admin or
-- owner) and had no permission key of its own. Here the list, create, edit and delete actions are separate keys so a
-- workspace can hand them out apart; the locked Admin preset gets all of them, which is exactly who could open the
-- screens in Reference. Managers, agents and viewers get none (Reference: 403 / redirect to the inbox).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wgt.widgets.read',   'View chatbot widgets',                   'widgets', false),
  ('wgt.widgets.create', 'Create and duplicate chatbot widgets',   'widgets', false),
  ('wgt.widgets.update', 'Edit, pause and rotate chatbot widgets', 'widgets', false),
  ('wgt.widgets.delete', 'Delete chatbot widgets',                 'widgets', false)
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
    ('wgt.widgets.read'),
    ('wgt.widgets.create'),
    ('wgt.widgets.update'),
    ('wgt.widgets.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
