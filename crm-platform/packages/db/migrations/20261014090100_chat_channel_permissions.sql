-- chat: the capability key for connecting and configuring channels.
-- Why this migration exists (plan-inbox-chat.md section 2 row 1): WaDesk kept every connection screen behind the workspace-role check of
-- its integrations area. Reading the list of connected channels needs no new key (anyone who may read conversations sees which channels
-- exist, with no secret); changing them is `inbox.channel.manage`. The trigger of the workspace-preset migration grants a new key to the
-- Owner and Admin presets of every organization, which is exactly who could connect a number in WaDesk; Managers, Agents and Viewers get none.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('inbox.channel.manage', 'Connect, edit and remove messaging channels', 'inbox', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
