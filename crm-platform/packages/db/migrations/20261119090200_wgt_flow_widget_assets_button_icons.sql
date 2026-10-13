-- wgt: the small picture of a button in a website bot's flow (a reply button or a link button).
-- Why: an author can give a button in the flow builder a picture (optional). It has to be an address a visitor's browser can load from
-- any site, so it is kept like the other widget pictures: one row per flow and slot, here `bi` and eight hex digits chosen by the
-- upload, so every button keeps its own picture and replacing one never changes another.
ALTER TABLE flow_widget_assets DROP CONSTRAINT chk_flow_widget_assets_slot;
ALTER TABLE flow_widget_assets ADD CONSTRAINT chk_flow_widget_assets_slot
  CHECK (slot ~ '^(logo|popup|avatar|background|(nb|qm|bn)[0-4]|bi[0-9a-f]{8})$');
