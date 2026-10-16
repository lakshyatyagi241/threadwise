-- A flow's FAQ answering is on by default, in the schema as well as in the code: a settings row written without an explicit `enabled`
-- is on. Existing rows are not touched here (the previous migration already switched the saved-off ones on).
--
-- Metadata only: the column default changes, no rows are rewritten and no policy or index changes. The application always sends
-- `enabled` on save, so this default only decides rows written by other paths.

ALTER TABLE faq_settings ALTER COLUMN enabled SET DEFAULT true;
