-- @no-transaction
-- The waiting queue and its badge: only the few threads a handoff put in a queue, longest wait first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_waiting
  ON conversations (org_id, handling_since) WHERE handling = 'waiting';
