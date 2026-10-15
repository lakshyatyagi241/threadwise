-- compliance center (BL-172 to BL-179, spec docs/specs/privacy-and-data-governance.md section 11): the settings a workspace needs to switch on
-- the extras of a privacy regime, the sub-processor list it can publish, and the terms link beside the privacy link of a consent notice.
--
--   1. `consent_notices` learns `terms_url` (the terms the wording points to, next to `url`, the privacy link) and a fourth scope,
--      `workspace`: the workspace's own default wording, one notice per language (`scope_ref` is the language code). Both are additive:
--      no row changes, no applied migration is edited, the immutability trigger is untouched (it only guards UPDATE).
--   2. `compliance_settings`: one row per workspace. The regime profiles that are switched on, the officer contacts (data protection
--      officer, grievance officer), the privacy and terms links, the children flag, the DPDP / CCPA extras, and the quiet hours, calling
--      window and DND registry choice. The quiet hours and windows are STORED here; nothing enforces them yet (BL-177).
--   3. `compliance_subprocessors`: the vendors a workspace lists as processing personal data for it, with an optional public page.
--
-- No row of either new table is a person's data: the officer contacts are the workspace's own business contacts.

ALTER TABLE consent_notices ADD COLUMN terms_url text;
ALTER TABLE consent_notices ADD CONSTRAINT ck_consent_notices_terms_url CHECK (
  terms_url IS NULL OR (char_length(terms_url) <= 500 AND terms_url ~* '^https://[^[:space:]]+$')
);
ALTER TABLE consent_notices DROP CONSTRAINT ck_consent_notices_scope;
ALTER TABLE consent_notices ADD CONSTRAINT ck_consent_notices_scope CHECK (scope IN ('widget', 'booking', 'commerce', 'workspace'));

-- ---------------------------------------------------------------------------------------------------------------------------------

CREATE TABLE compliance_settings (
  org_id                    bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The profiles switched on. Empty until a person confirms a choice (`regimes_confirmed_at`); the country only SUGGESTS.
  regimes                   text[] NOT NULL DEFAULT '{}',
  regimes_confirmed_at      timestamptz,
  privacy_url               text,
  terms_url                 text,
  -- Data protection officer / privacy contact (GDPR, UK GDPR, LGPD, PDPA).
  dpo_name                  text NOT NULL DEFAULT '',
  dpo_email                 text NOT NULL DEFAULT '',
  dpo_phone                 text NOT NULL DEFAULT '',
  dpo_address               text NOT NULL DEFAULT '',
  -- Grievance officer (DPDP Act, India).
  grievance_name            text NOT NULL DEFAULT '',
  grievance_email           text NOT NULL DEFAULT '',
  grievance_phone           text NOT NULL DEFAULT '',
  grievance_address         text NOT NULL DEFAULT '',
  children_policy           text NOT NULL DEFAULT 'unset',
  parental_consent_required boolean NOT NULL DEFAULT false,
  offer_sale_share_opt_out  boolean NOT NULL DEFAULT false,
  opt_out_notice_url        text,
  -- DPDP consent manager: a placeholder. Nothing is integrated.
  consent_manager_name      text NOT NULL DEFAULT '',
  consent_manager_url       text,
  quiet_hours_enabled       boolean NOT NULL DEFAULT false,
  quiet_start               text NOT NULL DEFAULT '21:00',
  quiet_end                 text NOT NULL DEFAULT '08:00',
  calling_window_enabled    boolean NOT NULL DEFAULT false,
  calling_start             text NOT NULL DEFAULT '08:00',
  calling_end               text NOT NULL DEFAULT '21:00',
  -- ISO weekdays, 1 Monday to 7 Sunday.
  calling_days              smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  -- IANA zone the quiet hours and the calling window are read in; NULL = the workspace's own.
  window_timezone           text,
  dnd_registry              text NOT NULL DEFAULT 'none',
  secondary_notice_locale   text,
  subprocessors_public      boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  row_version               integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id),
  CONSTRAINT ck_compliance_regimes CHECK (
    regimes <@ ARRAY['gdpr_eu', 'uk_gdpr', 'dpdp_in', 'ccpa_us', 'tcpa_us', 'trai_in', 'lgpd_br', 'pdpa_sg', 'generic']::text[]
  ),
  CONSTRAINT ck_compliance_children CHECK (children_policy IN ('unset', 'no_minors', 'may_include_minors')),
  CONSTRAINT ck_compliance_dnd CHECK (dnd_registry IN ('none', 'trai_ndnc', 'us_dnc', 'sg_dnc', 'custom')),
  CONSTRAINT ck_compliance_times CHECK (
    quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND calling_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND calling_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  CONSTRAINT ck_compliance_days CHECK (calling_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT ck_compliance_locale CHECK (secondary_notice_locale IS NULL OR secondary_notice_locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$'),
  CONSTRAINT ck_compliance_urls CHECK (
    (privacy_url IS NULL OR (char_length(privacy_url) <= 500 AND privacy_url ~* '^https://[^[:space:]]+$'))
    AND (terms_url IS NULL OR (char_length(terms_url) <= 500 AND terms_url ~* '^https://[^[:space:]]+$'))
    AND (opt_out_notice_url IS NULL OR (char_length(opt_out_notice_url) <= 500 AND opt_out_notice_url ~* '^https://[^[:space:]]+$'))
    AND (consent_manager_url IS NULL OR (char_length(consent_manager_url) <= 500 AND consent_manager_url ~* '^https://[^[:space:]]+$'))
  ),
  CONSTRAINT ck_compliance_lengths CHECK (
    char_length(dpo_name) <= 120 AND char_length(dpo_email) <= 200 AND char_length(dpo_phone) <= 40 AND char_length(dpo_address) <= 300
    AND char_length(grievance_name) <= 120 AND char_length(grievance_email) <= 200 AND char_length(grievance_phone) <= 40
    AND char_length(grievance_address) <= 300 AND char_length(consent_manager_name) <= 120
  )
);

ALTER TABLE compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compliance_settings FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_compliance_settings_touch BEFORE UPDATE ON compliance_settings
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------------------------------------------------------------

CREATE TABLE compliance_subprocessors (
  org_id          bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id              bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid            uuid NOT NULL DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  purpose         text NOT NULL DEFAULT '',
  data_categories text NOT NULL DEFAULT '',
  -- Country or region where the vendor processes the data.
  location        text NOT NULL DEFAULT '',
  website_url     text,
  dpa_url         text,
  status          text NOT NULL DEFAULT 'active',
  added_on        date,
  notice_sent_on  date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT ck_compliance_sub_status CHECK (status IN ('active', 'planned', 'removed')),
  CONSTRAINT ck_compliance_sub_lengths CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 120 AND char_length(purpose) <= 300 AND char_length(data_categories) <= 300
    AND char_length(location) <= 120
  ),
  CONSTRAINT ck_compliance_sub_urls CHECK (
    (website_url IS NULL OR (char_length(website_url) <= 500 AND website_url ~* '^https://[^[:space:]]+$'))
    AND (dpa_url IS NULL OR (char_length(dpa_url) <= 500 AND dpa_url ~* '^https://[^[:space:]]+$'))
  )
);
-- One entry per vendor name in a workspace, whatever the capitalisation.
CREATE UNIQUE INDEX uq_compliance_sub_name ON compliance_subprocessors (org_id, lower(btrim(name)));

ALTER TABLE compliance_subprocessors ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_subprocessors FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compliance_subprocessors FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_compliance_subprocessors_touch BEFORE UPDATE ON compliance_subprocessors
  FOR EACH ROW EXECUTE FUNCTION touch_row();
