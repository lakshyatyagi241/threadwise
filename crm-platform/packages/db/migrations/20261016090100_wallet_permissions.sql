-- wallet: capability keys for the customer-facing wallet screens.
-- Why this migration exists (WD-WALLET-020, -021, -022, -023): WaDesk showed the wallet tab, the statement and the CSV to any signed-in
-- user with no key at all. They are keys here so a workspace can hide the balance or the export from a role, and every preset holds
-- them by default (the workspace_preset_baseline extension point), so nothing changes until an Owner edits a role.
-- The operator console (rates, switches, adjusting a workspace's wallet, the logs) carries no key: it is guarded by operator roles.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wallet.balance.read',     'View the wallet balance and message prices', 'billing', false),
  ('wallet.statement.read',   'View the wallet statement',                  'billing', false),
  ('wallet.statement.export', 'Export the wallet statement as CSV',         'billing', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
CROSS JOIN (VALUES ('wallet.balance.read'), ('wallet.statement.read'), ('wallet.statement.export')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
