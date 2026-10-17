-- 20261222100000_drop_sla_pause_when_waiting
-- Why this migration exists (not what it does — the SQL says that):
--
-- "Pause while waiting on the customer" is removed from both SLA policy forms by the owner's decision. Its only effect was the team
-- inbox's pending pause (the pending status is gone) and, on the support desk, a flag the clock never read. Both columns had no reader,
-- so they are dropped rather than kept as settings that do nothing.

ALTER TABLE sla_policies DROP COLUMN pause_when_waiting_on_customer;
ALTER TABLE support_sla_policies DROP COLUMN pause_when_waiting_on_customer;
