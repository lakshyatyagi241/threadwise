-- Waiting queue settings (docs/specs/conversation-handoff-and-assignment.md, BL-410 follow-up): timers for a chat that waits in the
-- queue (a reminder, an offer to another team, a final step), and chats that nobody could take at arrival now enter the queue.
--
-- Why: the Waiting tab, the handoff strip and the age badge exist, but nothing happened to a chat that kept waiting, and a new chat
-- that no rule or agent could take only sat in the Unassigned tab. This adds:
--
--   conversation_handoffs.source       gets the value 'arrival' (a new chat the routing engine could not give to anybody).
--   conversation_handoffs.reminded_at  when the "remind people" step ran for this wait (null = not yet): the step runs at most once.
--   conversation_handoffs.offered_at / offered_from_team_id
--                                      when the chat was offered to the overflow team, and the team it was taken from.
--   conversation_handoffs.final_at / final_action
--                                      when the last step ran (a message to the customer, or the chat given back to the bot).
--   workspace_settings.handoff_wq_*    the workspace's choices. Every default is OFF / "keep waiting": nothing changes for any
--                                      existing workspace until an admin saves a setting on the Auto-assignment page.
--
-- Expand-only (blue-green): new nullable columns and columns with defaults, one CHECK widened to accept a new value (the old code never
-- writes it). No data is rewritten and nothing is backfilled: chats that already wait or are unassigned are not touched at deploy.

-- --- conversation_handoffs ------------------------------------------------------------------------------------------------------

ALTER TABLE conversation_handoffs
  ADD COLUMN reminded_at           timestamptz,
  ADD COLUMN offered_at            timestamptz,
  ADD COLUMN offered_from_team_id  bigint,
  ADD COLUMN final_at              timestamptz,
  ADD COLUMN final_action          text,
  ADD CONSTRAINT fk_conversation_handoffs_offered_from FOREIGN KEY (org_id, offered_from_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (offered_from_team_id),
  ADD CONSTRAINT chk_conversation_handoffs_final_action
    CHECK (final_action IS NULL OR final_action IN ('message', 'bot')) NOT VALID;

-- The source list gains 'arrival'. The old constraint is replaced by a superset, so rows written by the previous release stay valid.
ALTER TABLE conversation_handoffs
  DROP CONSTRAINT chk_conversation_handoffs_source,
  ADD CONSTRAINT chk_conversation_handoffs_source
    CHECK (source IN ('flow', 'ai_agent', 'keyword', 'bot_failure', 'manual', 'arrival')) NOT VALID;

-- --- workspace settings ---------------------------------------------------------------------------------------------------------

ALTER TABLE workspace_settings
  ADD COLUMN handoff_wq_remind_minutes     integer,
  ADD COLUMN handoff_wq_overflow_minutes   integer,
  ADD COLUMN handoff_wq_overflow_team_id   bigint,
  ADD COLUMN handoff_wq_unclaimed_minutes  integer,
  ADD COLUMN handoff_wq_unclaimed_action   text NOT NULL DEFAULT 'keep',
  ADD COLUMN handoff_wq_unclaimed_message  text,
  ADD CONSTRAINT fk_workspace_settings_wq_overflow_team FOREIGN KEY (org_id, handoff_wq_overflow_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (handoff_wq_overflow_team_id),
  ADD CONSTRAINT chk_workspace_settings_wq_remind
    CHECK (handoff_wq_remind_minutes IS NULL OR handoff_wq_remind_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT chk_workspace_settings_wq_overflow
    CHECK (handoff_wq_overflow_minutes IS NULL OR handoff_wq_overflow_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT chk_workspace_settings_wq_unclaimed
    CHECK (handoff_wq_unclaimed_minutes IS NULL OR handoff_wq_unclaimed_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT chk_workspace_settings_wq_action
    CHECK (handoff_wq_unclaimed_action IN ('keep', 'message', 'bot')),
  ADD CONSTRAINT chk_workspace_settings_wq_message
    CHECK (handoff_wq_unclaimed_message IS NULL OR char_length(handoff_wq_unclaimed_message) <= 1000);
