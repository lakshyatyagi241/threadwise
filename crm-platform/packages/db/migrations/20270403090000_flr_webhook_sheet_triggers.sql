-- flr: two more ways to start a flow, matching Geta's Automation Journey triggers: `webhook` (an outside system posts to the flow's own
-- address) and `google_sheet` (a new row in a sheet).
--
-- The webhook needs no column: its token is an HMAC of the flow's uuid under the server's secret, so nothing is stored.
-- The sheet is polled, so each flow keeps a bookmark: how many rows it has already seen. `flow_sheet_cursor` holds it. A flow with
-- no row here has never been polled, so its first poll only records the sheet's current size and starts nothing (no backfill of old
-- rows); the poller deletes the row when the flow stops being live, so turning the trigger on again starts from the sheet as it is then.

ALTER TABLE flows DROP CONSTRAINT chk_flows_trigger_kind;
ALTER TABLE flows ADD CONSTRAINT chk_flows_trigger_kind CHECK (trigger_kind IN
  ('keyword','tag_added','group_join','manual_enroll','contact_created','opt_in','order_placed',
   'appointment_booked','deal_stage_changed','away','out_of_hours','comment_to_dm',
   'group_leave','segment_join','segment_leave','contact_updated','field_match','date_field_match','schedule',
   'shopify_event','woocommerce_event','webhook','google_sheet'));

CREATE TABLE flow_sheet_cursor (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flow_id bigint NOT NULL,
  -- `<spreadsheet id>|<tab>`: a flow pointed at another sheet or tab starts over from that sheet's size, not from this one's row count.
  sheet_key text NOT NULL,
  -- Rows of the sheet (header included) already looked at.
  last_row integer NOT NULL,
  last_polled_at timestamptz NOT NULL DEFAULT now(),
  -- The stable code of the last failed read (GOOGLE_ACCOUNT_NOT_CONNECTED, ...); null after a good one.
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, flow_id),
  CONSTRAINT fk_flow_sheet_cursor_flow_id FOREIGN KEY (org_id, flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_flow_sheet_cursor_last_row CHECK (last_row >= 0)
);

ALTER TABLE flow_sheet_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_sheet_cursor FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON flow_sheet_cursor FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
