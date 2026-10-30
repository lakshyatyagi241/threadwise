-- 2050_chat_idle_rules
-- Why (legacy #15590, #15593): a chat held by an agent never ended on its own. Two optional timers, both OFF (NULL) by default, so
-- nothing changes for an existing workspace until an admin saves a value:
--
--   handoff_unanswered_return_min  an open chat whose customer has waited this many minutes with no human reply goes back to the team's
--                                  queue (the same return the away rules do when a person goes Offline).
--   handoff_idle_close_min         an open chat with no message for this many minutes is resolved.
--
-- Expand-only: two nullable columns with a range CHECK; no data is rewritten.
ALTER TABLE workspace_settings
  ADD COLUMN handoff_unanswered_return_min integer,
  ADD COLUMN handoff_idle_close_min        integer,
  ADD CONSTRAINT chk_workspace_settings_unanswered_return
    CHECK (handoff_unanswered_return_min IS NULL OR handoff_unanswered_return_min BETWEEN 1 AND 1440),
  ADD CONSTRAINT chk_workspace_settings_idle_close
    CHECK (handoff_idle_close_min IS NULL OR handoff_idle_close_min BETWEEN 1 AND 10080);
