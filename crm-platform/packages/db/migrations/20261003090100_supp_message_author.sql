-- supp: a reply's author is either the ticket's customer (a tenant user) or a platform operator.
-- Why this migration exists: support_messages.author_user_id is a composite FK to users (org_id, id), which an operator
-- (platform_operators, a separate identity pool) can never satisfy. Operator replies and notes record author_operator_id
-- instead; author_user_id stays for the customer's own follow-ups. Exactly one of the two is set for a person's message
-- (a system message, role 'system', has neither).

ALTER TABLE support_messages
  ADD COLUMN author_operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_support_messages_one_author
    CHECK (author_user_id IS NULL OR author_operator_id IS NULL);

CREATE INDEX idx_support_messages_author_operator_id ON support_messages (author_operator_id);
