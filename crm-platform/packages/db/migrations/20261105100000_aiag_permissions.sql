-- aiag: capability keys for AI Training (trained chat assistants, their knowledge entries, the responder mode).
-- Why this migration exists (TW-AIAG-001..): Reference put /ai-training behind the "admin" tier only, with no finer split. The keys make that
-- rule the server's rule and let a workspace split it: viewing assistants and their knowledge, creating (or duplicating) one, editing one
-- and its knowledge entries, deleting one, and choosing who answers the workspace's WhatsApp (an org-wide switch, so no record scope).
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000), so existing
-- workspaces are covered by this insert and new ones by provisioning. No other preset holds them by default.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('aiag.training.read',   'View AI training assistants and their knowledge', 'ai', false),
  ('aiag.training.create', 'Create or duplicate an AI training assistant',    'ai', false),
  ('aiag.training.update', 'Edit an AI training assistant and its knowledge', 'ai', false),
  ('aiag.training.delete', 'Delete an AI training assistant',                 'ai', false),
  ('aiag.responder.manage', 'Choose who answers the workspace WhatsApp (our AI or Meta Business Agent)', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
