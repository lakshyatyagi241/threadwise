-- 2040_wizard_csv_row_consent
-- Why this migration exists (not what it does — the SQL says that):
--
-- A broadcast CSV may carry a marketing-consent column (yes / no per row), the same as the contact importer reads. The upload kept
-- only one file-wide confirmation, so a file with the column still counted every number as "No consent recorded", and a ticked
-- confirmation granted rows that said no. Each valid row now keeps what its consent cell said. Additive and nullable: NULL means
-- the file had no consent column (or the upload predates it), so the file-wide confirmation decides, as before.

ALTER TABLE camp_wizard_csv_rows ADD COLUMN consent_granted boolean;
