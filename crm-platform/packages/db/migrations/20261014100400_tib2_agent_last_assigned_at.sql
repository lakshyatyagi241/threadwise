-- tib2: a real round-robin clock for assignment (plan-inbox-chat.md section 7 row 12).
-- Why this migration exists: Reference's "round robin" picks the member whose conversations have the oldest `updated_at`, which any
-- edit bumps, so it is not a rotation. The assignment service stamps `last_assigned_at` on the agent it just picked (under a row lock)
-- and picks the oldest stamp next; NULL (never assigned) sorts first.
ALTER TABLE agent_statuses ADD COLUMN last_assigned_at timestamptz;
CREATE INDEX idx_agent_statuses_last_assigned ON agent_statuses (org_id, last_assigned_at NULLS FIRST);
