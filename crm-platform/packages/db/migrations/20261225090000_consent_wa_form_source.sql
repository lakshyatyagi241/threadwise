-- consent at WhatsApp Form submission (TW-WFL, net addition -- Reference never captures consent on a form at all): a WhatsApp
-- Form field mapped to privacy:consent_marketing or privacy:consent_service writes a grant whose source is wa_form, distinct from
-- the web-forms feature's own `form` source so the two intake surfaces stay traceable apart in the ledger. The constraint is
-- dropped and re-created with the full list; no row changes, no applied migration is edited, and no grant is invented for any
-- existing submission.

ALTER TABLE contact_consent_events DROP CONSTRAINT ck_consent_events_source;
ALTER TABLE contact_consent_events ADD CONSTRAINT ck_consent_events_source CHECK (
  source IN ('form', 'keyword', 'manual', 'import', 'api', 'flow', 'inbound_message', 'contact_request', 'legacy', 'widget', 'booking', 'commerce', 'lead', 'wa_form')
);
