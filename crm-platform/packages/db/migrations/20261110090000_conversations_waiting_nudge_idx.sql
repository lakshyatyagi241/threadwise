-- @no-transaction
-- notif: find the unassigned chats whose customer is still waiting, without scanning every conversation (BL-098).
-- Why this migration exists: the "waiting for a reply" sweep runs every minute across all workspaces and asks for open, unassigned,
-- unmuted chats with an unanswered customer message in a time window. No existing index leads with the message time, so that
-- question was a scan of `conversations`. This partial index holds only such chats (a small, shrinking set: a chat leaves it the moment
-- someone is assigned, replies, reads it or resolves it), ordered by the latest customer message. CONCURRENTLY so it does not block
-- writes on a live table, which is why this file runs outside a transaction and holds exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_waiting_nudge
  ON conversations (last_inbound_at DESC)
  WHERE status = 'open' AND NOT archived AND muted_at IS NULL
    AND assignee_user_id IS NULL AND assignee_team_id IS NULL AND assignee_agent_id IS NULL
    AND waiting_since IS NOT NULL AND unread_count > 0;
