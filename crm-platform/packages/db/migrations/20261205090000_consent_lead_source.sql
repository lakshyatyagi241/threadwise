-- consent at lead capture (BL-168, privacy spec docs/specs/privacy-and-data-governance.md section 4.3.2): a lead form or ad that carries
-- the person's own agreement (the wording they saw, its version, when they agreed, the provider's form and ad ids) is delivered by a
-- connector or the generic lead webhook. The ledger learns the source `lead` for that grant. The constraint is dropped and re-created with
-- the full list; no row changes, no applied migration is edited, and no grant is invented for any existing lead.

ALTER TABLE contact_consent_events DROP CONSTRAINT ck_consent_events_source;
ALTER TABLE contact_consent_events ADD CONSTRAINT ck_consent_events_source CHECK (
  source IN ('form', 'keyword', 'manual', 'import', 'api', 'flow', 'inbound_message', 'contact_request', 'legacy', 'widget', 'booking', 'commerce', 'lead')
);
