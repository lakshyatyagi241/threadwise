-- chat: find the message that holds a media key (plan-inbox-chat.md 3.2 / chat-media.md "Reading").
-- Why this migration exists: the media route serves a stored file only to someone who may still see the conversation it belongs to, so it
-- has to go from the object key to the message (and its thread) at read time. `messages` is partitioned by month and nothing indexed
-- `media_key`, so that lookup would scan every partition of the workspace. The index is partial (most messages carry no file) and starts
-- with `org_id` like every tenant index; each monthly partition inherits it.
CREATE INDEX idx_messages_media_key ON messages (org_id, media_key) WHERE media_key IS NOT NULL;
