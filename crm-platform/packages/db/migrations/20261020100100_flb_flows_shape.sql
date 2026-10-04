-- flb: flow list search and the lifecycle invariants the editor relies on.
-- Why this migration exists (TW-FLB-001, 004, 019): Reference encrypted the flow name and filtered the whole workspace in PHP,
-- so every list was O(all flows). Here the name is plain text and the list filters, searches and counts in SQL; the indexes
-- below serve those queries. The CHECKs state what the code already enforces (a flow is one of ten channels, its trigger
-- is one of twelve kinds), so a bad write from any other path fails in the database rather than showing up as a ghost row.

CREATE INDEX idx_flows_org_updated ON flows (org_id, updated_at DESC, id DESC);
CREATE INDEX idx_flows_org_state ON flows (org_id, is_published, is_active);
CREATE INDEX idx_flows_name_trgm ON flows USING gin (flow_name gin_trgm_ops);

ALTER TABLE flows
  ADD CONSTRAINT chk_flows_flow_type CHECK (flow_type IN
    ('chat','call','instagram','facebook','tiktok','telegram','line','wechat','viber','email')),
  ADD CONSTRAINT chk_flows_trigger_kind CHECK (trigger_kind IN
    ('keyword','tag_added','group_join','manual_enroll','contact_created','opt_in','order_placed',
     'appointment_booked','deal_stage_changed','away','out_of_hours','comment_to_dm')),
  ADD CONSTRAINT chk_flows_flow_name_len CHECK (char_length(flow_name) BETWEEN 1 AND 255),
  ADD CONSTRAINT chk_flows_category_len CHECK (category IS NULL OR char_length(category) <= 64);

ALTER TABLE flow_templates
  ADD CONSTRAINT chk_flow_templates_flow_type CHECK (flow_type IN
    ('chat','call','instagram','facebook','tiktok','telegram','line','wechat','viber','email')),
  ADD CONSTRAINT chk_flow_templates_sort_order CHECK (sort_order BETWEEN 0 AND 9999);
CREATE INDEX idx_flow_templates_sort ON flow_templates (sort_order, id DESC);
