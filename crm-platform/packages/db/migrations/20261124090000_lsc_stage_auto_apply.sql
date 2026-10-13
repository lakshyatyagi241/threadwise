-- lsc stage auto apply: the workspace chooses whether a stage the AI finds in a chat is applied by itself or left for a person.
--
-- What it adds:
--   lead_scoring_settings.stage_auto_apply: with `stage_suggestions` on, true (the default) moves the contact straight away, tells the
--       chat with a line that has an Undo, and keeps the suggestion as `auto_applied` (`undone` after an Undo); false leaves each
--       suggestion pending for a person to accept or dismiss, as before. Has no effect while `stage_suggestions` is off.
--
-- Existing workspaces get the default (automatic), so the switch is the same for everyone until they change it.

ALTER TABLE lead_scoring_settings
  ADD COLUMN stage_auto_apply boolean NOT NULL DEFAULT true;
