-- flr: "contact leaves a segment" trigger. A segment is computed on demand, so a departure is only visible by comparing with what
-- the flow saw last time. flow_segment_state keeps that: one row per flow and contact, true while the flow last found them inside.

ALTER TABLE flows DROP CONSTRAINT chk_flows_trigger_kind;
ALTER TABLE flows ADD CONSTRAINT chk_flows_trigger_kind CHECK (trigger_kind IN
  ('keyword','tag_added','group_join','manual_enroll','contact_created','opt_in','order_placed',
   'appointment_booked','deal_stage_changed','away','out_of_hours','comment_to_dm',
   'group_leave','segment_join','segment_leave','contact_updated','field_match','date_field_match','schedule',
   'shopify_event','woocommerce_event'));

CREATE TABLE flow_segment_state (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flow_id bigint NOT NULL,
  contact_id bigint NOT NULL,
  inside boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id, contact_id),
  CONSTRAINT fk_flow_segment_state_flow_id FOREIGN KEY (org_id, flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_flow_segment_state_contact_id FOREIGN KEY (org_id, contact_id) REFERENCES contacts (org_id, id) ON DELETE CASCADE
);

ALTER TABLE flow_segment_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_segment_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON flow_segment_state FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
