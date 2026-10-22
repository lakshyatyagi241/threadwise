-- Validates the NOT VALID checks of 20270301090000_handoff_schema.sql. Separate so the scan of `conversations` does not hold the lock of
-- the schema change; VALIDATE CONSTRAINT only takes SHARE UPDATE EXCLUSIVE and does not block writes. Every row is NULL, so it passes.
ALTER TABLE conversations VALIDATE CONSTRAINT chk_conversations_handling;
ALTER TABLE conversations VALIDATE CONSTRAINT chk_conversations_assigned_source;
