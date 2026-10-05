-- chat: find inbound messages whose file is still being copied from the provider (WhatsApp media-fetch, plan-inbox-chat.md Phase 2).
-- Why this migration exists: a customer's file is downloaded by a background job after the message is stored, and the message says so
-- in `meta.mediaStatus` ('pending'). A recovery sweep puts a pending message back on the queue when its job was lost (the process died
-- between the commit and the enqueue, or Redis lost the job). That sweep looks across every workspace at pending rows only; `messages`
-- is large and partitioned by month, so without an index it would read every recent row. The index is partial (almost no message is
-- pending at any moment), starts with the time the sweep orders by, and each monthly partition inherits it.
CREATE INDEX idx_messages_media_pending ON messages (created_at) WHERE (meta ->> 'mediaStatus') = 'pending';
