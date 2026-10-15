-- consent confirmation for the broadcast wizard's CSV audience (BL-170, privacy spec docs/specs/privacy-and-data-governance.md section
-- 4.3.2). The contact import already asks "I have consent to message these contacts"; the wizard's "Broadcast via CSV" now does the same.
-- The answer belongs to the upload, because a recurring broadcast reads the same upload again and again:
--
--   consent_confirmed       the person uploading confirmed they hold consent for every number in the file
--   consent_notice_text     the notice or lawful basis they stated the file's contacts agreed under (optional)
--   consent_notice_version  its version (optional)
--
-- Default false: an upload made before this migration, or without the confirmation, records NO consent (the numbers still become
-- contacts at launch, as before, and stay "No consent recorded"). No row changes and no applied migration is edited.

ALTER TABLE camp_wizard_csv ADD COLUMN consent_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE camp_wizard_csv ADD COLUMN consent_notice_text text;
ALTER TABLE camp_wizard_csv ADD COLUMN consent_notice_version text;
ALTER TABLE camp_wizard_csv ADD CONSTRAINT ck_camp_wizard_csv_notice
  CHECK (char_length(coalesce(consent_notice_text, '')) <= 2000 AND char_length(coalesce(consent_notice_version, '')) <= 64);
