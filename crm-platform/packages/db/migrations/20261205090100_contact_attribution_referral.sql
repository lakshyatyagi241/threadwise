-- click-to-WhatsApp ad referral as evidence (BL-169, privacy spec docs/specs/privacy-and-data-governance.md section 4.3.2): when a person's
-- first message comes from an ad (Meta `referral`: the ad, its link, headline and click id), the contact keeps that as an attribution
-- touch. POLICY: a first inbound message permits replying only. Clicking an ad is not an agreement, so this writes NOTHING to the consent
-- ledger and grants no marketing; it is the record of how the person reached us.
--
--   evidence      the referral fields (source type, ad or post id, link, headline, click id), short strings, no IP address
--   external_ref  the provider's message id behind the touch ("ctwa:<id>"): a redelivery of the same message writes one touch
--
-- Touches stay append-only: the trigger now guards the two new columns as well. No row changes and no applied migration is edited.

ALTER TABLE contact_attributions ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contact_attributions ADD COLUMN external_ref text;
ALTER TABLE contact_attributions ADD CONSTRAINT ck_contact_attributions_evidence
  CHECK (jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 4096);
ALTER TABLE contact_attributions ADD CONSTRAINT ck_contact_attributions_ref
  CHECK (external_ref IS NULL OR char_length(external_ref) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX uq_contact_attributions_ref ON contact_attributions (org_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION contact_attributions_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.contact_id, NEW.platform, NEW.source_label, NEW.campaign, NEW.adset, NEW.ad, NEW.form, NEW.captured_at, NEW.evidence, NEW.external_ref)
     IS DISTINCT FROM
     (OLD.contact_id, OLD.platform, OLD.source_label, OLD.campaign, OLD.adset, OLD.ad, OLD.form, OLD.captured_at, OLD.evidence, OLD.external_ref) THEN
    RAISE EXCEPTION 'contact_attributions is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
