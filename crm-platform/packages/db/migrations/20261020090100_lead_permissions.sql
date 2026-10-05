-- lead: capability keys for lead sources (spec L-12; EXT-LEAD).
-- Why this migration exists: Reference's incoming webhook had no role gate beyond being signed in to the workspace, and a lead source is
-- the one place where anybody on the internet who holds a token writes contacts into a workspace. Reading the sources (names, status,
-- recent events, never the secret) and managing them (create, rotate the token, change the mapping, send a test lead, retry an event,
-- open a raw payload that holds personal data) are separate keys so a workspace can let a sales lead watch the events without letting
-- them change where leads go.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000), so existing
-- workspaces are covered by this insert and new ones by provisioning. No other preset holds them by default: a workspace widens that in
-- its role editor.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('leads.sources.read',   'View lead sources and their recent events',                                       'leads', false),
  ('leads.sources.manage', 'Create and change lead sources, rotate tokens, test and retry leads, open lead payloads', 'leads', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
