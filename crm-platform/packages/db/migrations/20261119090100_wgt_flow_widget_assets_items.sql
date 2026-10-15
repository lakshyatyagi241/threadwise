-- wgt: pictures for the items of a website bot's notification cards, quick menu and banner.
-- Why: each card, menu entry and banner slide can carry its own picture (up to five of each), kept like the logo and the avatar:
-- one row per flow and slot, replaced in place. The slot check named four fixed slots; it now also takes the fifteen item slots
-- (`nb0`..`nb4` notification cards, `qm0`..`qm4` menu entries, `bn0`..`bn4` banner slides).
ALTER TABLE flow_widget_assets DROP CONSTRAINT chk_flow_widget_assets_slot;
ALTER TABLE flow_widget_assets ADD CONSTRAINT chk_flow_widget_assets_slot
  CHECK (slot ~ '^(logo|popup|avatar|background|(nb|qm|bn)[0-4])$');
