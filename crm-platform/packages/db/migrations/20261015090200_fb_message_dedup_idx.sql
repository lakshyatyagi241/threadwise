-- fb: find a Facebook message by Meta's id without scanning the table (TW-FB-007, 009).
--
-- Why this exists: Meta delivers a webhook at least once and in any order, so every inbound message and comment is first looked up by
-- its Meta id (`mid` or comment id, kept at `meta.facebook.message_id`) and dropped when it is already stored. Reference ran that lookup as
-- a JSON path scan joined to conversations; `messages` here is partitioned by month and large, so the lookup gets its own index.
-- Partial on the provider so it holds Facebook rows only.

CREATE INDEX IF NOT EXISTS idx_messages_facebook_message_id
  ON messages (org_id, ((meta -> 'facebook' ->> 'message_id')))
  WHERE provider = 'facebook';
