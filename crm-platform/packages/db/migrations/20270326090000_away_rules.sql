-- Away rules (docs/specs/conversation-handoff-and-assignment.md, waiting queue follow-up; Smart routing, default OFF).
--
--   workspace_settings.handoff_return_on_away     when a person goes Offline or starts a leave, the open chats they hold whose customer is still
--                                                 waiting for a reply go back to the team's queue (Waiting). Default false: nothing changes.
--   workspace_settings.handoff_auto_offline_min   an Available person with no activity for this many minutes is set Offline (and then the
--                                                 rule above applies). NULL = never (default).
--
-- Expand-only (blue-green): one boolean with a default and one nullable integer with a CHECK; no data is rewritten and no existing workspace
-- changes behaviour until an admin saves the setting on the Auto-assignment page.

ALTER TABLE workspace_settings
  ADD COLUMN handoff_return_on_away    boolean NOT NULL DEFAULT false,
  ADD COLUMN handoff_auto_offline_min  integer,
  ADD CONSTRAINT chk_workspace_settings_auto_offline
    CHECK (handoff_auto_offline_min IS NULL OR handoff_auto_offline_min BETWEEN 1 AND 1440);
