-- 20261006090000_inst_setup_run_progress
-- Progress of the six-step install run (TW-INST-010).
--
-- Reference's run screen posts six sub-steps and never checks their order, so a client could call any of them, and a
-- reload re-ran everything (a second workspace after step 4). The server now remembers the highest step that
-- succeeded; step n is accepted only while run_step >= n - 1, and repeating a finished step is allowed because every
-- step is idempotent. platform_setup is already forced-RLS and privileged-only, so this column adds no new access.

ALTER TABLE platform_setup
  ADD COLUMN run_step smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_platform_setup_run_step CHECK (run_step BETWEEN 0 AND 6);
