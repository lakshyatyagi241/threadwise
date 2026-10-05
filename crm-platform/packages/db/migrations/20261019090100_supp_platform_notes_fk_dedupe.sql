-- supp: drop the duplicate conversation foreign key that 20261019090000_supp_helpdesk_platform.sql added to platform_notes.
-- Why this migration exists: the chat reshape (20261014100000) had already given platform_notes a composite foreign key to
-- conversations with ON DELETE SET NULL (conversation_id), so a note outlives a deleted conversation. The second key (CASCADE) I
-- added would delete the note instead, and the two together are contradictory. The earlier migration is applied and immutable, so
-- this one removes the redundant key and keeps the original behaviour.

ALTER TABLE platform_notes DROP CONSTRAINT fk_platform_notes_conversation;
