-- api: capability keys for the Developers console (API keys).
-- Why this migration exists (TW-API-001, 003, 010): Reference put /developers behind login only (any member, even an agent, could list, create
-- and revoke the workspace key), while its menu showed the entry to owners and admins. The keys make the menu's rule the server's rule:
-- reading keys, creating one and revoking one are separate, so a workspace can let a developer see the key's state without letting them
-- mint or revoke.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000), so existing
-- workspaces are covered by this insert and new ones by provisioning. No other preset holds them by default.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('api.keys.read',   'View the REST API keys of this workspace', 'developer', false),
  ('api.keys.create', 'Create a REST API key',                    'developer', false),
  ('api.keys.revoke', 'Revoke a REST API key',                    'developer', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
