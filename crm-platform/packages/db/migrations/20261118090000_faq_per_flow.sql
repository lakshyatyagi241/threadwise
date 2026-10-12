-- faq: FAQs belong to a flow (ADR-0021, addendum 2).
--
-- Until now an FAQ belonged to the workspace and answered on any channel; the workspace had one settings row. The owner wants it the
-- way a bot's knowledge works: each flow has its own FAQs, its own settings and its own match log, and they answer only inside that
-- flow. So:
--   * faqs.owner_flow_id: the flow the FAQ belongs to (delete the flow, its FAQs go). faqs.flow_id keeps meaning "the flow the answer
--     starts" (the answer target); it defaults to the owner in the editor.
--   * faq_settings is keyed by (org_id, flow_id): the switch, the sensitivity and the second check are per flow.
--   * faq_match_logs.flow_id: Unanswered, the log and Insights are per flow.
--   * the unique question is unique within a flow, not across the workspace.
--
-- The feature is new and off by default, nothing is in production: existing rows (dev databases only) are deleted instead of being
-- assigned to a flow they never had.

DELETE FROM faq_match_logs;
DELETE FROM faq_variations;
DELETE FROM faqs;
DELETE FROM faq_settings;

-- faqs ---------------------------------------------------------------------------------------------------------------------------
ALTER TABLE faqs ADD COLUMN owner_flow_id bigint NOT NULL;
ALTER TABLE faqs ADD CONSTRAINT fk_faqs_owner_flow
  FOREIGN KEY (org_id, owner_flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE;
DROP INDEX uq_faqs_question;
CREATE UNIQUE INDEX uq_faqs_question ON faqs (org_id, owner_flow_id, lower(btrim(question)));
CREATE INDEX idx_faqs_owner ON faqs (org_id, owner_flow_id, status);

-- faq_settings: one row per flow ---------------------------------------------------------------------------------------------
ALTER TABLE faq_settings DROP CONSTRAINT faq_settings_pkey;
ALTER TABLE faq_settings ADD COLUMN flow_id bigint NOT NULL;
ALTER TABLE faq_settings ADD PRIMARY KEY (org_id, flow_id);
ALTER TABLE faq_settings ADD CONSTRAINT fk_faq_settings_flow
  FOREIGN KEY (org_id, flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE;

-- faq_match_logs ---------------------------------------------------------------------------------------------------------------
ALTER TABLE faq_match_logs ADD COLUMN flow_id bigint NOT NULL;
ALTER TABLE faq_match_logs ADD CONSTRAINT fk_faq_match_logs_flow
  FOREIGN KEY (org_id, flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE;
DROP INDEX idx_faq_match_logs_created;
CREATE INDEX idx_faq_match_logs_created ON faq_match_logs (org_id, flow_id, created_at DESC);
DROP INDEX idx_faq_match_logs_unanswered;
CREATE INDEX idx_faq_match_logs_unanswered ON faq_match_logs (org_id, flow_id, created_at DESC)
  WHERE origin = 'inbound' AND outcome IN ('below_threshold', 'low_margin', 'no_faqs') AND resolved_at IS NULL;
