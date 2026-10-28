-- 2038_kb_failed_heal_count
-- Why this migration exists (not what it does — the SQL says that):
-- The embed worker re-queued every `failed` passage once a minute and reset its attempt counter, so one passage the vendor always
-- refuses was sent again forever (vendor spend on the platform key, silently). This column counts the automatic re-queues of a failed
-- passage; the worker stops after a fixed number (kb.rules.ts MAX_FAILED_HEALS). Additive: the default 0 is the state every existing row
-- already is in, and the table keeps its RLS policy untouched.

ALTER TABLE ai_training_chunks ADD COLUMN embed_heal_count smallint NOT NULL DEFAULT 0;
