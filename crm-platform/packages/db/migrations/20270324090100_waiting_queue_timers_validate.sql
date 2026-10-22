-- Validates the two CHECK constraints that 20270324090000_waiting_queue_timers.sql added NOT VALID (the handoff source list that gained
-- 'arrival', and the final action). Both tables are small and every stored row satisfies them (the old release never wrote anything else),
-- so the scan is quick; VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, so reads and writes go on.
ALTER TABLE conversation_handoffs VALIDATE CONSTRAINT chk_conversation_handoffs_source;
ALTER TABLE conversation_handoffs VALIDATE CONSTRAINT chk_conversation_handoffs_final_action;
