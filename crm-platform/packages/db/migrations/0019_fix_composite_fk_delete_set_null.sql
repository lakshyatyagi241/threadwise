-- 0019_fix_composite_fk_delete_set_null
-- Every composite tenant-scoping FK — (org_id, x) REFERENCES parent (org_id, id)
-- — that also has ON DELETE SET NULL is broken by construction: Postgres nulls
-- EVERY column of a multi-column FK on that action, including org_id, but
-- org_id is NOT NULL (it's half of the row's own primary key). The delete on
-- the PARENT then fails outright with "null value in column org_id violates
-- not-null constraint" the moment a real child row exists — found live via
-- DELETE /v2/field-sections/:id once a field still pointed at the section.
--
-- Fix: Postgres 15+'s column-restricted ON DELETE SET NULL (col) syntax nulls
-- only the named column and leaves org_id untouched. Applied to every
-- constraint of this shape in the schema, not just the one that surfaced it —
-- same bug, same fix, everywhere it occurs.

ALTER TABLE companies
  DROP CONSTRAINT companies_org_id_owner_id_fkey,
  ADD CONSTRAINT companies_org_id_owner_id_fkey
    FOREIGN KEY (org_id, owner_id) REFERENCES users (org_id, id) ON DELETE SET NULL (owner_id);

ALTER TABLE contacts
  DROP CONSTRAINT contacts_org_id_company_id_fkey,
  ADD CONSTRAINT contacts_org_id_company_id_fkey
    FOREIGN KEY (org_id, company_id) REFERENCES companies (org_id, id) ON DELETE SET NULL (company_id);

ALTER TABLE contacts
  DROP CONSTRAINT contacts_org_id_owner_id_fkey,
  ADD CONSTRAINT contacts_org_id_owner_id_fkey
    FOREIGN KEY (org_id, owner_id) REFERENCES users (org_id, id) ON DELETE SET NULL (owner_id);

ALTER TABLE contacts
  DROP CONSTRAINT fk_contacts_submitted_by_agent,
  ADD CONSTRAINT fk_contacts_submitted_by_agent
    FOREIGN KEY (org_id, submitted_by_agent_id) REFERENCES partner_agents (org_id, id)
    ON DELETE SET NULL (submitted_by_agent_id);

ALTER TABLE fields
  DROP CONSTRAINT fields_org_id_section_id_fkey,
  ADD CONSTRAINT fields_org_id_section_id_fkey
    FOREIGN KEY (org_id, section_id) REFERENCES field_sections (org_id, id) ON DELETE SET NULL (section_id);

ALTER TABLE fields
  DROP CONSTRAINT fields_org_id_replaces_field_id_fkey,
  ADD CONSTRAINT fields_org_id_replaces_field_id_fkey
    FOREIGN KEY (org_id, replaces_field_id) REFERENCES fields (org_id, id)
    ON DELETE SET NULL (replaces_field_id);

ALTER TABLE contact_tags
  DROP CONSTRAINT contact_tags_org_id_created_by_fkey,
  ADD CONSTRAINT contact_tags_org_id_created_by_fkey
    FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);

ALTER TABLE contact_views
  DROP CONSTRAINT contact_views_org_id_created_by_fkey,
  ADD CONSTRAINT contact_views_org_id_created_by_fkey
    FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);

ALTER TABLE contact_notes
  DROP CONSTRAINT contact_notes_org_id_created_by_fkey,
  ADD CONSTRAINT contact_notes_org_id_created_by_fkey
    FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);

ALTER TABLE contact_notes
  DROP CONSTRAINT contact_notes_org_id_updated_by_fkey,
  ADD CONSTRAINT contact_notes_org_id_updated_by_fkey
    FOREIGN KEY (org_id, updated_by) REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by);

ALTER TABLE contact_files
  DROP CONSTRAINT contact_files_org_id_uploaded_by_fkey,
  ADD CONSTRAINT contact_files_org_id_uploaded_by_fkey
    FOREIGN KEY (org_id, uploaded_by) REFERENCES users (org_id, id) ON DELETE SET NULL (uploaded_by);

ALTER TABLE contact_activities
  DROP CONSTRAINT contact_activities_org_id_actor_id_fkey,
  ADD CONSTRAINT contact_activities_org_id_actor_id_fkey
    FOREIGN KEY (org_id, actor_id) REFERENCES users (org_id, id) ON DELETE SET NULL (actor_id);

ALTER TABLE contact_meetings
  DROP CONSTRAINT contact_meetings_org_id_created_by_fkey,
  ADD CONSTRAINT contact_meetings_org_id_created_by_fkey
    FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);
