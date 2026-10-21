-- Auto-assignment redesign: a rule can say "applies to every new conversation" (H13..H19 in docs/specs/conversation-handoff-and-assignment.md).
--
-- routing_rules.applies_to_all: the rule's "Only for conversations that match..." switch is OFF. The rule then matches every conversation and its stored
--   conditions are ignored (kept, so switching the condition switch back on restores them). Default false for every existing row: a rule that
--   exists today keeps the meaning it has now (a rule WITH conditions matches by them; the fallback with none is the catch-all; a hand-edited
--   non-fallback rule with no conditions never matched and still does not). Nothing is inferred from empty conditions.
-- Expand-only: one new column with a default. No data is changed, no rule is created.

ALTER TABLE routing_rules ADD COLUMN applies_to_all boolean NOT NULL DEFAULT false;
