-- flr: more ways to start a flow (the team's workflow gap list): a contact leaving a list, joining a segment, being updated,
-- a field matching a value, a date field coming due, a schedule, and store events.
-- Most of them need a few settings of their own (which field, which value, which time), so the trigger node's settings are kept
-- as JSON next to the plain columns the matcher already queries; `trigger_last_occurrence` is the schedule's own bookmark (the day
-- or date it last fired for), so a restart or a second worker never fires the same occurrence twice.

ALTER TABLE flows
  ADD COLUMN trigger_config jsonb,
  ADD COLUMN trigger_last_occurrence text;

ALTER TABLE flows DROP CONSTRAINT chk_flows_trigger_kind;
ALTER TABLE flows ADD CONSTRAINT chk_flows_trigger_kind CHECK (trigger_kind IN
  ('keyword','tag_added','group_join','manual_enroll','contact_created','opt_in','order_placed',
   'appointment_booked','deal_stage_changed','away','out_of_hours','comment_to_dm',
   'group_leave','segment_join','contact_updated','field_match','date_field_match','schedule',
   'shopify_event','woocommerce_event'));
