-- owning_team_id (BL-382): validates the foreign keys that 20270225090200 added NOT VALID.
-- VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock, so reads and writes of the four tables continue while it scans. At this
-- point every owning_team_id is NULL or was stamped by the trigger from a real team of the same workspace, so it always passes.
ALTER TABLE contacts  VALIDATE CONSTRAINT fk_contacts_owning_team_id;
ALTER TABLE companies VALIDATE CONSTRAINT fk_companies_owning_team_id;
ALTER TABLE deals     VALIDATE CONSTRAINT fk_deals_owning_team_id;
ALTER TABLE tasks     VALIDATE CONSTRAINT fk_tasks_owning_team_id;
