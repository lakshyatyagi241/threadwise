-- flb: capability keys for the flow builder and its editor.
-- Why this migration exists (WD-FLB-028): WaDesk gated every /flows route on "workspace role admin" and nothing else (the
-- four seeded keys flows.view/create/edit/delete were never read). Here the same people keep access, through real keys the
-- server checks on every route: a workspace can hand them out in its role editor. Publish is its own key because it is the
-- step that makes a flow answer customers; build and edit without it leaves a draft.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('flb.flows.read',    'View flows and the flow builder',               'flows', false),
  ('flb.flows.create',  'Create, import, duplicate and clone flows',     'flows', false),
  ('flb.flows.update',  'Edit, rename, pause and resume flows',          'flows', false),
  ('flb.flows.delete',  'Delete flows',                                  'flows', false),
  ('flb.flows.publish', 'Publish and unpublish flows',                   'flows', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys
-- by unlocking, granting and relocking here, as the contacts, deals and tasks migrations do. New organizations get every key
-- in permission_defs when they are provisioned. No other preset is granted: WaDesk's agents, viewers and managers could not
-- open /flows at all.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('flb.flows.read'), ('flb.flows.create'), ('flb.flows.update'), ('flb.flows.delete'), ('flb.flows.publish')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
