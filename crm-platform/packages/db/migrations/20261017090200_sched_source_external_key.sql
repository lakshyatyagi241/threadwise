-- sched: say where a schedule came from, and let a producer replace its own.
-- Why this migration exists (TW-SCHED-030): other domains create schedules without the composer (abandoned-cart recovery, appointment
-- reminders). Reference wrote those rows with an out-of-enum type and kept appointment reminders only in the bridge's memory under
-- synthetic ids, so they were lost on restart and invisible. `source` lets the list label or hide them; `external_key` is the
-- producer's own id (an appointment, a cart) so registering again replaces the old schedule instead of duplicating it.
ALTER TABLE scheduled_messages
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN external_key text;
ALTER TABLE scheduled_messages
  ADD CONSTRAINT chk_scheduled_messages_source CHECK (source ~ '^[a-z][a-z0-9_]{1,31}$');
CREATE UNIQUE INDEX uq_scheduled_messages_external_key ON scheduled_messages (org_id, external_key) WHERE external_key IS NOT NULL;
