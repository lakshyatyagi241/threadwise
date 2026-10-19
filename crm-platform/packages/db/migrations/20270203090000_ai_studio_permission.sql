-- AI Studio: its own capability key.
-- Why this migration exists: the AI Studio start page (AI agent, chatbot, workflow in one place) was gated only by `flb.flows.read`, so every
-- workspace that can open Flows got it, including a workspace migrated from Waboo, whose product never had such a page. A page of its own
-- needs a key of its own, so a workspace can be configured without it (the Waboo migration denies it on the preset roles).
--   flb.ai_studio.read   see the AI Studio start page and its menu entry
-- Held by the Owner and Admin presets, and by every custom role that can already open Flows, so no existing workspace loses the page.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('flb.ai_studio.read', 'See the AI Studio start page', 'flows', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'flb.ai_studio.read'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT g.org_id, g.role_id, 'flb.ai_studio.read', 'allow', g.record_scope
FROM role_grants g
JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
WHERE g.permission_key = 'flb.flows.read' AND g.effect = 'allow' AND r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
