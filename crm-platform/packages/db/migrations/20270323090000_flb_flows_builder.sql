-- flb: which builder a flow was made in.
-- A WhatsApp bot (Simple) and a messaging flow built on the Advanced canvas are both flow_type 'chat', so the flows list could not tell
-- them apart and drew the same WhatsApp mark on both. `builder` records where the flow was created ('simple' or 'advanced'); the
-- runtime does not read it, only the list does, to give an Advanced messaging flow its own picture.

ALTER TABLE flows
  ADD COLUMN builder text NOT NULL DEFAULT 'simple',
  ADD CONSTRAINT chk_flows_builder CHECK (builder IN ('simple', 'advanced'));
