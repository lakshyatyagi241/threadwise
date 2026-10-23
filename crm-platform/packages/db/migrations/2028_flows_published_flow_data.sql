-- 2028_flows_published_flow_data
-- Why this migration exists (not what it does — the SQL says that):
--
-- A published bot ran from `flow_data`, the same column the builder saves into, so any saved edit (the builder saves when a step is
-- closed) went live at once, without pressing Publish. Publishing now keeps a copy of the graph that went live in
-- `published_flow_data`; the runtime starts runs from that copy while the flow is published, and the draft in `flow_data` goes live
-- only at the next Publish. A flow published before this migration gets its current graph as its first copy, so nothing changes for it
-- until it is edited.
--
-- flows has FORCE ROW LEVEL SECURITY and the migration runner sets no tenant context, so without app.privileged the policy hides every
-- row from the migration role and the UPDATE changes nothing. The setting is transaction-local. A second run matches no rows.

ALTER TABLE flows ADD COLUMN IF NOT EXISTS published_flow_data jsonb;

SELECT set_config('app.privileged', 'on', true);

UPDATE flows SET published_flow_data = flow_data
WHERE is_published AND published_flow_data IS NULL AND flow_data IS NOT NULL;
