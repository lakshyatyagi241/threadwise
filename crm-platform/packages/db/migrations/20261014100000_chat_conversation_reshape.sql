-- chat: reshape `conversations` for the inbox that is actually being built (plan-inbox-chat.md section 3.3, owner decision 2).
-- Why this migration exists: the table was a literal copy of WaDesk's, which mixes three products in one row: the Quick Send queue
-- (recipients_count, scheduled_*, a sent/partial/failed roll-up in `status`), the team inbox (`inbox_status`, assignment, SLA) and a
-- polymorphic sender (`device_id` + `provider`, because WaDesk's devices and WABA configs share an id space). Here a conversation is one
-- perpetual thread per (channel, peer): `channel_id` replaces device + provider + platform + channel, `peer_key` replaces the digits
-- regexes on the title and `raw_jid`, there is ONE lifecycle `status`, and the row carries what the message pipeline needs as state
-- (`msg_seq` allocated under the row lock, `window_expires_at` for the 24 hour rule, `waiting_since` as the SLA anchor).
--
-- Nothing in the product wrote real conversations before this (the web chat widget and the broadcast mirror are the only writers, and
-- both are moved to the new shape in the same change), so legacy rows are discarded rather than guessed into a channel. The cascade
-- takes their notes, labels and participants with them; the nullable references from other tables (deals, widget visitors, support
-- notes) are set to NULL by their own foreign keys.
--
-- `channel_id` gets its composite foreign key to `channels` in 20261014100500_chat_channel_fks.sql, because the channels table is
-- created by a separate migration of the channel registry.
--
-- Deviation from the plan text, recorded in parity/chat-conversations.md: `closed` stays a legal status. WaDesk's inbox has both
-- `resolved` and `closed` (its status filter offers them separately), so dropping it would lose a state agents can reach today.

SELECT set_config('app.privileged', 'on', true);

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM conversations;
  IF n > 0 THEN
    RAISE NOTICE 'chat reshape: discarding % pre-reshape conversation row(s) (development data; no channel to attach them to)', n;
  END IF;
END $$;

DELETE FROM conversations;

-- --- columns that belonged to Quick Send, the polymorphic sender, or were never read -------------------------------------------------
-- Dropping a column drops the foreign keys and indexes that involve it.
ALTER TABLE conversations
  DROP COLUMN user_id,
  DROP COLUMN device_id,
  DROP COLUMN contact_group_id,
  DROP COLUMN raw_jid,
  DROP COLUMN alt_jid,
  DROP COLUMN contact_digits,
  DROP COLUMN platform,
  DROP COLUMN provider,
  DROP COLUMN origin,
  DROP COLUMN channel,
  DROP COLUMN recipients_count,
  DROP COLUMN scheduled_at,
  DROP COLUMN scheduled_timezone,
  DROP COLUMN interested_sku,
  DROP COLUMN interested_product_id,
  DROP COLUMN interested_seen_at,
  DROP COLUMN inbox_status,
  DROP COLUMN is_spam;

-- --- the thread's identity and the pipeline state -------------------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN channel_id bigint NOT NULL,
  -- The peer on that channel: normalised digits for phone channels, the channel's own thread id otherwise. A thread must exist before
  -- (or without) a contact, so the peer, not the contact, is the key.
  ADD COLUMN peer_key text NOT NULL,
  ADD COLUMN peer_name text,
  -- Highest `messages.seq` handed out in this thread. Allocated by `UPDATE ... SET msg_seq = msg_seq + 1` inside the transaction that
  -- holds the row lock, so clients can order a thread by it and detect a gap.
  ADD COLUMN msg_seq bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_message_id bigint,
  -- Free-form replies are allowed until this instant (stamped on inbound for channels that have a window); NULL = no window rule.
  ADD COLUMN window_expires_at timestamptz,
  -- Start of the current wait for a human answer: set by the first unanswered inbound, cleared by a reply. SLA clocks anchor here.
  ADD COLUMN waiting_since timestamptz,
  -- The thread has no contact record because the contact quota was reached; an inbound message is never dropped for that reason.
  ADD COLUMN needs_contact boolean NOT NULL DEFAULT false;

ALTER TABLE conversations ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE conversations
  ADD CONSTRAINT chk_conversations_status CHECK (status IN ('open', 'pending', 'snoozed', 'resolved', 'closed', 'spam')),
  ADD CONSTRAINT chk_conversations_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD CONSTRAINT chk_conversations_unread_count CHECK (unread_count >= 0),
  ADD CONSTRAINT chk_conversations_msg_seq CHECK (msg_seq >= 0);

-- --- indexes ---------------------------------------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_conversations_escalation_due_at;
DROP INDEX IF EXISTS idx_conversations_last_inbound_at;
DROP INDEX IF EXISTS idx_conversations_last_message_at;
DROP INDEX IF EXISTS idx_conversations_last_outbound_at;
DROP INDEX IF EXISTS idx_conversations_pinned_at;
DROP INDEX IF EXISTS idx_conversations_priority;
DROP INDEX IF EXISTS idx_conversations_sla_breached;
DROP INDEX IF EXISTS idx_conversations_sla_first_response_due;
DROP INDEX IF EXISTS idx_conversations_sla_resolution_due;
DROP INDEX IF EXISTS idx_conversations_snoozed_until;
DROP INDEX IF EXISTS idx_conversations_unread_count;

-- One perpetual thread per contact per channel (architecture/messaging.md), keyed by the peer.
ALTER TABLE conversations ADD CONSTRAINT uq_conversations_channel_peer UNIQUE (org_id, channel_id, peer_key);

-- The list: lifecycle tab, archived flag, pinned first, newest activity first, id as the tie-break so a keyset cursor is stable.
CREATE INDEX idx_conversations_queue
  ON conversations (org_id, status, archived, pinned_at DESC NULLS LAST, last_message_at DESC, id DESC);
CREATE INDEX idx_conversations_assignee_user ON conversations (org_id, assignee_user_id, status);
CREATE INDEX idx_conversations_assignee_team ON conversations (org_id, assignee_team_id, status);
CREATE INDEX idx_conversations_unread ON conversations (org_id, last_message_at DESC) WHERE unread_count > 0;

-- Sweep indexes. The sweeps run privileged across every workspace and ask "what is due now", so these deliberately do not start with
-- org_id and are partial on the only rows a sweep can act on.
CREATE INDEX idx_conversations_snooze_due ON conversations (snoozed_until) WHERE status = 'snoozed' AND snoozed_until IS NOT NULL;
CREATE INDEX idx_conversations_escalation_due ON conversations (escalation_due_at) WHERE escalation_due_at IS NOT NULL;
CREATE INDEX idx_conversations_sla_first_due
  ON conversations (sla_first_response_due) WHERE sla_first_response_due IS NOT NULL AND NOT sla_breached;
CREATE INDEX idx_conversations_sla_resolution_due
  ON conversations (sla_resolution_due) WHERE sla_resolution_due IS NOT NULL AND NOT sla_breached;
