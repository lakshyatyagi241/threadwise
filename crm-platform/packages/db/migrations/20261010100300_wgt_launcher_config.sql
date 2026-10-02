-- wgt: the WhatsApp widget's look and placement as one config object (WD-WGT-028; user-requested Interakt reference).
-- Why this migration exists: the WhatsApp widget builder gained a button type, a colour, a messenger image, a greeting and
-- intro text and a separate desktop and mobile position with spacing. They live in ONE jsonb object instead of a column
-- each, so the next option the reference adds is a new key with a default in the contract, not another migration. The
-- shape is validated by the API on every write (`widgetLauncherSchema`); the database only guarantees it is an object,
-- and a row that predates a key reads that key's default. The table keeps its forced RLS and its tenant policy: adding a
-- column changes neither.
ALTER TABLE chatbot_widgets
  ADD COLUMN IF NOT EXISTS launcher jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chatbot_widgets
  ADD CONSTRAINT chk_chatbot_widgets_launcher_object CHECK (jsonb_typeof(launcher) = 'object');
