-- alib: capability keys for the API Library (docs/api/api-library.md).
-- Why this migration exists: a saved API sends the workspace's data to an address someone typed and can hold a token, so the screen is
-- not for every member. Five keys, all org-wide (no record scope): see the list and its logs, create, edit, delete, and run a test (a
-- test makes a real request). Reading is also what the flow editor's "API (from library)" picker needs; the picker feed accepts
-- `flb.flows.read` as well, so a flow author does not need the screen.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000); the Manager
-- preset gets all five here and, through `workspace_preset_baseline`, in every workspace provisioned later. Agent and Viewer hold none.
-- Not behind a plan feature: no existing plan feature fits (the flow builder's own `automation` gate already covers using the node).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('integ.apilibrary.read',   'View the API Library, its logs and where each API is used', 'integrations', false),
  ('integ.apilibrary.create', 'Create saved APIs in the API Library',                      'integrations', false),
  ('integ.apilibrary.update', 'Edit saved APIs in the API Library',                        'integrations', false),
  ('integ.apilibrary.delete', 'Delete saved APIs from the API Library',                    'integrations', false),
  ('integ.apilibrary.test',   'Run test requests from the API Library',                    'integrations', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES
  ('integ.apilibrary.read'),
  ('integ.apilibrary.create'),
  ('integ.apilibrary.update'),
  ('integ.apilibrary.delete'),
  ('integ.apilibrary.test')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
