-- A bot's fallback message: what a customer gets when none of the flow's FAQs answers their message. It lives with the flow's other
-- FAQ settings (same row, same version), is NULL when the flow has none (the customer then hears nothing, as before), and is stored
-- exactly as typed or migrated: spelling and punctuation are the owner's.
--
-- Metadata only: one nullable column, no rewrite of existing rows, no policy or index change (faq_settings keeps its tenant_isolation
-- policy and its composite key).

ALTER TABLE faq_settings
  ADD COLUMN fallback_message text,
  ADD CONSTRAINT ck_faq_settings_fallback_message CHECK (fallback_message IS NULL OR char_length(fallback_message) BETWEEN 1 AND 1024);
