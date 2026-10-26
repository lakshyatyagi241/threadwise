-- 2029_flows_published_trigger_snapshot
-- Why this migration exists (not what it does — the SQL says that):
--
-- 2028 kept a published bot's graph apart from the draft, but its trigger settings (the keyword words, the channel and engine it
-- listens on, the tag / group / event value, the schedule) were still read from the draft columns the builder saves into. A keyword
-- typed into the draft started the live bot, a changed channel moved it to another number, and a changed schedule fired at its new
-- time, all before Publish. Publishing now keeps a copy of these columns next to `published_flow_data`; the keyword matcher, the
-- enrolments, the schedule sweeper and the sender choice read the copy while the flow is published, as the runtime reads the graph
-- copy. A flow published before this migration gets its current settings as its first copy, so nothing changes for it until it is
-- edited and published again.
--
-- flows has FORCE ROW LEVEL SECURITY and the migration runner sets no tenant context, so the backfill needs app.privileged, as in 2028.
-- The setting is transaction-local. A second run matches no rows.

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS published_trigger_kind text,
  ADD COLUMN IF NOT EXISTS published_trigger_value bigint,
  ADD COLUMN IF NOT EXISTS published_trigger_keywords text,
  ADD COLUMN IF NOT EXISTS published_trigger_config jsonb,
  ADD COLUMN IF NOT EXISTS published_trigger_device_id bigint,
  ADD COLUMN IF NOT EXISTS published_trigger_channel_id bigint,
  ADD COLUMN IF NOT EXISTS published_provider text;

SELECT set_config('app.privileged', 'on', true);

UPDATE flows SET
  published_trigger_kind = trigger_kind,
  published_trigger_value = trigger_value,
  published_trigger_keywords = trigger_keywords,
  published_trigger_config = trigger_config,
  published_trigger_device_id = trigger_device_id,
  published_trigger_channel_id = trigger_channel_id,
  published_provider = provider
WHERE is_published AND published_trigger_kind IS NULL;
