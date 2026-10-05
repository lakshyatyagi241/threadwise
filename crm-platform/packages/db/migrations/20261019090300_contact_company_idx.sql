-- @no-transaction
-- company: index on contacts.company_id, for a company's contact list, its contact count and the unlink on delete (WD-CTP-005, 008).
-- Why this migration exists: 0004 added the composite foreign key to companies but no index on the referencing columns, so listing or
-- counting a company's contacts, and the ON DELETE SET NULL when a company is deleted, scanned every contact of the workspace.
-- CONCURRENTLY so it does not block writes on a live table, which is why this file runs outside a transaction and holds exactly
-- one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company_id
  ON contacts (org_id, company_id) WHERE company_id IS NOT NULL;
