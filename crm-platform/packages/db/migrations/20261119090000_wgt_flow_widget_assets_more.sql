-- wgt: more pictures for a website chat bot (its bot avatar and a chat background) and SVG as a picture format.
-- Why: the Customize tab of a website bot takes a company logo, the bot's picture and a background image, and an SVG logo is the
-- usual way a company ships its mark. The check constraints of `flow_widget_assets` named only the first two slots and the four raster
-- formats; they widen here. An SVG is accepted only after the API has refused anything that can run (script, event handlers, external
-- references) and is served with a locked-down content policy, so it can only ever be drawn as an image.
ALTER TABLE flow_widget_assets DROP CONSTRAINT chk_flow_widget_assets_slot;
ALTER TABLE flow_widget_assets ADD CONSTRAINT chk_flow_widget_assets_slot
  CHECK (slot IN ('logo', 'popup', 'avatar', 'background'));
ALTER TABLE flow_widget_assets DROP CONSTRAINT chk_flow_widget_assets_mime;
ALTER TABLE flow_widget_assets ADD CONSTRAINT chk_flow_widget_assets_mime
  CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'));
