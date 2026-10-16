-- FAQ answering is on by default for every flow. A flow that never saved has no row and now reads as on; a flow that was saved with
-- the switch off gets its row switched on here, so the default holds for every flow, not only the ones nobody touched.
--
-- Data only: no column, table or policy changes. faq_settings already has RLS enabled and forced. Saving a row again still accepts
-- enabled = false, so a flow can be switched off on purpose. The touch trigger bumps row_version on each switched row, so a screen
-- that still holds the old version gets a conflict on its next save instead of silently writing back the off state.

UPDATE faq_settings SET enabled = true WHERE enabled = false;
