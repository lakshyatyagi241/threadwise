-- webhooks: capability keys for the workspace's outbound webhooks (the Webhooks tile under Settings > Integrations).
-- Why this migration exists (TW-API-141, INTG): Reference let any member open the webhook screens, and the API created webhooks with no plan or
-- role check at all. Reading the list and managing endpoints (create, change, delete, test) are separate keys, so a workspace can let a
-- developer see the delivery state without letting them add a destination that receives its contacts' data.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000), so existing
-- workspaces are covered by this insert and new ones by provisioning. No other preset holds them by default.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('webhooks.read',   'View the outbound webhooks of this workspace and their deliveries', 'developer', false),
  ('webhooks.manage', 'Create, change, delete and test outbound webhooks',                 'developer', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
