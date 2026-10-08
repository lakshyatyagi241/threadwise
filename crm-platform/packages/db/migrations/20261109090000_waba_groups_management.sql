-- waba: managing Cloud API groups (BL-094 phases 1 and 2; spec docs/specs/waba-groups-management.md sections 8 and 9).
-- Why this migration exists: WaDesk gated every `/waba-groups` route on the workspace admin role and nothing else (no plan gate). Here the
-- screen, creating, the per-group changes (link reset, subject, join requests, removing people) and deleting are four keys a workspace can
-- hand out apart; the presets hold them as WaDesk's role did: Owner and Admin. Groups belong to a number, not to a record owner, so none of
-- the keys carries a record scope (the same as `waba.numbers.*`).
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('waba.groups.read',   'View WhatsApp groups, their invite links and member counts',                 'whatsapp', false),
  ('waba.groups.create', 'Create WhatsApp groups',                                                      'whatsapp', false),
  ('waba.groups.manage', 'Change a WhatsApp group (invite link, subject, join requests, members)',      'whatsapp', false),
  ('waba.groups.delete', 'Delete WhatsApp groups',                                                      'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES
  ('waba.groups.read'),
  ('waba.groups.create'),
  ('waba.groups.manage'),
  ('waba.groups.delete')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- Who made the group from here (null for a group the webhook mirrored, or whose maker was deleted). The audit row already names the actor;
-- this lets the list say it without a join into the audit log.
ALTER TABLE waba_groups ADD COLUMN created_by_user_id bigint;
ALTER TABLE waba_groups
  ADD CONSTRAINT fk_waba_groups_created_by_user_id
    FOREIGN KEY (org_id, created_by_user_id) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by_user_id);

-- The list is newest first for one number, by keyset (created_at, id). The number's filter is mandatory on the list.
CREATE INDEX idx_waba_groups_list ON waba_groups (org_id, provider_config_id, created_at DESC, id DESC);

-- Plan feature `waba_groups` (owner decision 2026-10-08: WhatsApp Groups is a paid plan feature, not in every plan; WaDesk had no gate).
-- Every plan row says so explicitly (the registry default is false): off everywhere except the three demo plans that `seed:auth` creates
-- (starter, growth, scale), so local testing keeps working. A plan of another name keeps it off until the operator ticks it in the plan editor.
UPDATE plans SET features = features || '{"waba_groups": false}'::jsonb
 WHERE kind = 'plan' AND NOT (features ? 'waba_groups');
UPDATE plans SET features = features || '{"waba_groups": true}'::jsonb
 WHERE kind = 'plan' AND slug IN ('starter', 'growth', 'scale');
