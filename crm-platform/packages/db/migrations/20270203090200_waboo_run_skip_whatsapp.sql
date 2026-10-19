-- Waboo migration panel: a testing switch per run, "do not migrate the WhatsApp number".
-- Why: while the migration is being tested, the owner wants the whole workspace to migrate WITHOUT importing the WhatsApp credentials and
-- connecting the number (that moves a live number's inbound events to this app). The run keeps the choice so a scheduled or queued run
-- starts with the same switch it was created with, and the runner agent starts the pipeline with --no-whatsapp. Default false: today's behaviour.

ALTER TABLE waboo_migration_runs
  ADD COLUMN skip_whatsapp boolean NOT NULL DEFAULT false;
