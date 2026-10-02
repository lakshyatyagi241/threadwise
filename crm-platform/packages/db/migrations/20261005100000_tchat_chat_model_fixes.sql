-- tchat: fixes to the ported team-chat tables before any feature uses them (TW-TCHAT-003, 009, 014).
-- Why this migration exists:
--   1. last_read_message_id defaults to 0 ("nothing read yet") but was ported as a foreign key to team_chat_messages, so the
--      first read pointer of a user could not be inserted, and deleting the message a user last read would have deleted
--      their pointer (ON DELETE CASCADE). A read pointer is a bare high-water mark, not a reference: the FKs go.
--   2. History and the unread count both walk one channel by message id; (org_id, channel_id, id) serves them.
--   3. A message must say something: text or an attachment (Reference answered "empty" with a 422 and stored nothing).
--   4. Every workspace has a public #general (Reference created it on the first visit; the service still does, with ON CONFLICT).
ALTER TABLE team_chat_channel_members DROP CONSTRAINT fk_team_chat_channel_members_last_read_message_id;
ALTER TABLE team_chat_reads DROP CONSTRAINT fk_team_chat_reads_last_read_message_id;

CREATE INDEX idx_team_chat_messages_channel_id ON team_chat_messages (org_id, channel_id, id);
CREATE INDEX idx_team_chat_messages_pinned ON team_chat_messages (org_id, channel_id, pinned_at) WHERE pinned_at IS NOT NULL;
CREATE INDEX idx_team_chat_invitations_created_at ON team_chat_invitations (org_id, created_at DESC, id DESC);

ALTER TABLE team_chat_messages
  ADD CONSTRAINT chk_team_chat_messages_has_content CHECK (body IS NOT NULL OR attachment_path IS NOT NULL),
  ADD CONSTRAINT chk_team_chat_messages_attachment_name CHECK (attachment_path IS NULL OR attachment_name IS NOT NULL),
  ADD CONSTRAINT chk_team_chat_messages_channel_required CHECK (channel_id IS NOT NULL);

SELECT set_config('app.privileged', 'on', true);
INSERT INTO team_chat_channels (org_id, name, slug, description, type)
  SELECT o.id, 'general', 'general', 'Everyone in this workspace', 'public' FROM organizations o
ON CONFLICT (org_id, slug) DO NOTHING;
