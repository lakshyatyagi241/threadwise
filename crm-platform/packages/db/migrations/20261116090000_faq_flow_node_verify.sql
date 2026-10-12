-- faq: three additions to the FAQ knowledge base (ADR-0021, addendum).
--
-- 1. faqs.flow_node_id: "link to node". A FAQ whose answer is a flow can start that flow at a chosen node (Geta's link-to-node)
--    instead of at its trigger. The node id is the editor's node id inside flows.flow_data; it is checked when the FAQ is saved and
--    again when a run starts, because the flow can be edited afterwards.
-- 2. faq_settings.verify_mode / verify_band: an optional second opinion from a small chat model for matches that only just cleared
--    the threshold (score inside [threshold, threshold + band)). Off by default; a veto turns the answer into a silent miss that the
--    unanswered list shows, because a wrong auto-answer costs more than a missing one.
-- 3. faq_match_logs: the verdict of that check, and a new origin 'flow' for the matches the Flow "FAQ" node runs.

ALTER TABLE faqs ADD COLUMN flow_node_id text;
ALTER TABLE faqs ADD CONSTRAINT ck_faqs_flow_node CHECK (
  flow_node_id IS NULL OR (answer_type = 'flow' AND btrim(flow_node_id) <> '' AND length(flow_node_id) <= 120)
);

ALTER TABLE faq_settings ADD COLUMN verify_mode text NOT NULL DEFAULT 'off';
ALTER TABLE faq_settings ADD COLUMN verify_band numeric(4,3) NOT NULL DEFAULT 0.100;
ALTER TABLE faq_settings ADD CONSTRAINT ck_faq_settings_verify_mode CHECK (verify_mode IN ('off', 'borderline'));
ALTER TABLE faq_settings ADD CONSTRAINT ck_faq_settings_verify_band CHECK (verify_band BETWEEN 0.010 AND 0.300);

-- confirmed: the model agreed; rejected: it vetoed the answer; error: the model failed, the match stood (a provider outage never
-- silences the FAQ); skipped: outside the band, switched off, or the hourly limit was reached.
ALTER TABLE faq_match_logs ADD COLUMN verify_verdict text;
ALTER TABLE faq_match_logs ADD COLUMN verify_model text;
ALTER TABLE faq_match_logs ADD COLUMN verify_reason text;
ALTER TABLE faq_match_logs ADD CONSTRAINT ck_faq_match_logs_verify CHECK (
  verify_verdict IS NULL OR verify_verdict IN ('confirmed', 'rejected', 'error', 'skipped')
);

ALTER TABLE faq_match_logs DROP CONSTRAINT ck_faq_match_logs_origin;
ALTER TABLE faq_match_logs ADD CONSTRAINT ck_faq_match_logs_origin CHECK (origin IN ('inbound', 'test', 'flow'));
-- The unanswered list must keep showing inbound customer messages only: a flow node's miss has its own port in the flow.
