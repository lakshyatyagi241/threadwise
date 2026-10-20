-- deals: who created a deal (staff), so the record scope `own` can mean "I own it or I created it" in the deals list too (BL-380, decision D1).
-- Why this migration exists: every other CRM record already carries its creator (contacts, companies, tasks, appointments, invoices, ...) and the
-- one scope resolver counts the creator in `own` and `team` everywhere; deals were the only record with no creator column to count.
-- Deals that exist today keep NULL (the creator was never stored and is not guessed), so nobody gains or loses sight of an existing deal. A deal
-- made from a flow, an import or the public API has no staff creator (NULL).
ALTER TABLE deals ADD COLUMN created_by bigint;
ALTER TABLE deals
  ADD CONSTRAINT fk_deals_created_by FOREIGN KEY (org_id, created_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);
CREATE INDEX idx_deals_created_by ON deals (org_id, created_by) WHERE created_by IS NOT NULL;
