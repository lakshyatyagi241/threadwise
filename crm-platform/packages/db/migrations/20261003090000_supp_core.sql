-- supp: the helpdesk's staff are platform operators, not tenant users, and its vocabulary needs enforcing.
-- Why this migration exists: 20261001102800_supp_threadwise_schema.sql (immutable) pointed support_tickets.assigned_agent_id
-- at users (org_id, id), but a ticket is worked by a PLATFORM OPERATOR (separate identity pool, platform_operators),
-- which a tenant user row can never be. The column keeps its name and now references the operator. The value lists Reference
-- accepted as free strings become CHECKs, and each message records whether its customer email went out.

ALTER TABLE support_tickets DROP CONSTRAINT fk_support_tickets_assigned_agent_id;
ALTER TABLE support_tickets
  ADD CONSTRAINT fk_support_tickets_assigned_operator
  FOREIGN KEY (assigned_agent_id) REFERENCES platform_operators (id) ON DELETE SET NULL;

ALTER TABLE support_tickets
  ADD CONSTRAINT chk_support_tickets_status
    CHECK (status IN ('open', 'in_progress', 'pending', 'resolved', 'closed')),
  ADD CONSTRAINT chk_support_tickets_priority
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD CONSTRAINT chk_support_tickets_reason
    CHECK (reason IN ('bug', 'delivery', 'template', 'billing', 'integration', 'account', 'other'));

ALTER TABLE support_messages
  ADD COLUMN email_status text,
  ADD CONSTRAINT chk_support_messages_author_role
    CHECK (author_role IN ('customer', 'admin', 'system')),
  ADD CONSTRAINT chk_support_messages_email_status
    CHECK (email_status IS NULL OR email_status IN ('sent', 'failed'));

-- The operator inbox lists every organization's tickets newest first (keyset on created_at, id).
CREATE INDEX idx_support_tickets_created_at ON support_tickets (created_at DESC, id DESC);
