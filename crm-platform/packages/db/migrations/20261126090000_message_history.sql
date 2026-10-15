-- message history: the Message History screen (Reference /message-history, TW-CHAT-039 to -042).
--
--   msg.history.read   open the Message History screen. Reference gates it with the workspace role `manager`; here the key is held by the
--                      Manager preset and above (Owner and Admin get every new key by the trigger on `permission_defs`). Which ROWS a
--                      holder sees is the scope of `inbox.conversation.read`: a message of a conversation they cannot open is not shown.
--
--   The feed reads the recipient tables of broadcasts, campaigns and scheduled messages next to the message stream, newest first by
--   the moment the send happened (`sent_at`, else the row's creation). Those tables had no index on time, so an expression index per
--   table keeps a page of the feed a bounded index scan instead of a sort of the whole workspace.
--
--   message_log_exports gains `kind` (the delivery-log export keeps 'events'; the history export is 'messages') and `filters` (the
--   screen's filters, resolved to absolute instants on the day of the request, so a "last 30 days" export means the same thing when
--   the worker builds it as when it was asked for).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('msg.history.read', 'View Message History', 'inbox', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'msg.history.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

CREATE INDEX idx_broadcast_contacts_org_at
  ON broadcast_contacts (org_id, (COALESCE(sent_at, created_at)) DESC, id DESC);
CREATE INDEX idx_wp_campaign_contacts_org_at
  ON wp_campaign_contacts (org_id, (COALESCE(sent_at, created_at)) DESC, id DESC);
CREATE INDEX idx_scheduled_message_contacts_org_at
  ON scheduled_message_contacts (org_id, (COALESCE(sent_at, created_at)) DESC, id DESC);

ALTER TABLE message_log_exports
  ADD COLUMN kind    text  NOT NULL DEFAULT 'events',
  ADD COLUMN filters jsonb;
ALTER TABLE message_log_exports
  ADD CONSTRAINT chk_message_log_exports_kind CHECK (kind IN ('events', 'messages'));

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
