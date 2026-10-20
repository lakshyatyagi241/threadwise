-- Drops the retired FAQ engine tables.
--
-- 20270205090000_kb_per_agent_vector_faq_merge moved every active text FAQ into one "FAQ" text entry per AI agent and kept the faq_*
-- tables as an archive "until verified". Nothing reads or writes them any more: the engine's code is gone and the legacy-data
-- loader (tools/migration, step faq_knowledge) writes the knowledge base instead. Children first, so no CASCADE is needed:
--   faq_match_logs   -> faqs, flows        (the matcher's log)
--   faq_variations   -> faqs               (phrasings and their vectors)
--   faq_settings     -> flows              (per-flow switch, thresholds, fallback message)
--   faqs             -> flows, users
-- Indexes, the tenant_isolation policies and the touch_row triggers go with their tables.

DO $$
DECLARE entries int; faqs int;
BEGIN
  SELECT count(*) INTO faqs FROM faqs WHERE status = 'active' AND answer_type = 'text';
  SELECT count(*) INTO entries FROM ai_training_sources WHERE kind = 'text' AND label = 'FAQ';
  RAISE NOTICE 'faq drop: % active text FAQs in the archive, % "FAQ" knowledge entries', faqs, entries;
END $$;

DROP TABLE IF EXISTS faq_match_logs;
DROP TABLE IF EXISTS faq_variations;
DROP TABLE IF EXISTS faq_settings;
DROP TABLE IF EXISTS faqs;

-- The saved window and last run of the FAQ match log: the item no longer exists on the retention page.
DELETE FROM data_retention_policies WHERE item = 'faq_match_log';
DELETE FROM data_retention_runs WHERE item = 'faq_match_log';
