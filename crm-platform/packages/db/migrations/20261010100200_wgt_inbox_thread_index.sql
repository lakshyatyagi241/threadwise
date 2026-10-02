-- wgt: serve the widget's per-conversation reads (TW-WGT-012, 016, 017, 018).
-- Why this migration exists: the transcript repaint, the 4-second history poll, the AI history block and the human-takeover
-- check all read `inbox_messages` by (org, conversation), and the table only carries single-purpose indexes, so each of
-- those reads would scan every monthly partition. The index is created on the parent so it reaches every partition,
-- under a widget-specific name so it cannot collide with one the team inbox domain adds for its own thread view.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_wgt_conversation
  ON inbox_messages (org_id, conversation_id, id);
