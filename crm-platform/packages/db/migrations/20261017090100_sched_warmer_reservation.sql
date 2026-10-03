-- sched: remember what a schedule reserved in its sender's warmer budget.
-- Why this migration exists (WD-SCHED-008 rule 4): WaDesk added a schedule's recipients to the sender's per-day warmer ledger when the
-- schedule was created and never gave them back, so cancelling, deleting or failing a schedule shrank that day's budget for good.
-- The schedule now records the day and the count it reserved, so the unsent part is released when it is cancelled, deleted or failed.
ALTER TABLE scheduled_messages
  ADD COLUMN warmer_reserved integer NOT NULL DEFAULT 0,
  ADD COLUMN warmer_reserved_day date;
ALTER TABLE scheduled_messages
  ADD CONSTRAINT chk_scheduled_messages_warmer_reserved CHECK (warmer_reserved >= 0);
