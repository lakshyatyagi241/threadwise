-- call: recording consent and lifecycle (BL-144, privacy spec section 5, voice-bot requirements points 2, 4, 11, 12).
-- Not a Reference feature: Reference recorded every inbound call from the first second, with no notice, no consent, no limit and no
-- deletion. Here recording is OFF until a workspace turns it on (decision D7), needs a versioned notice and the person's recorded answer
-- before any audio is kept, and is deleted by a daily sweep after the workspace's retention window (default 90 days, 7 to 365).
--
--   call_recording_settings          one row per workspace: the switch, the consent mode, the retention days, the current notice
--   call_recording_notice_versions   every text the workspace ever used as the notice, with its sha-256: a call's evidence points here
--   wa_calls.recording_*             the consent evidence of the call, when the file was stored, the legal hold, and when and why it was removed
--
-- Existing recordings: their retention clock starts when this migration runs (recording_stored_at = now()), so the first sweep cannot
-- delete a recording made before the setting existed without anyone having chosen a window. A workspace that wants a shorter window
-- sets it, and the sweep applies it from then on.

CREATE TABLE call_recording_settings (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Recording is off by default (D7).
  enabled boolean NOT NULL DEFAULT false,
  -- 'announcement': the operator reads the notice and the call goes on; 'confirmed': the person says yes and the operator records it.
  consent_mode text NOT NULL DEFAULT 'confirmed',
  retention_days integer NOT NULL DEFAULT 90,
  notice_text text,
  -- 0 = no notice written yet. Each edit of the text is a new version (a row of call_recording_notice_versions).
  notice_version integer NOT NULL DEFAULT 0,
  updated_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id),
  CONSTRAINT fk_call_recording_settings_updated_by FOREIGN KEY (org_id, updated_by) REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by),
  CONSTRAINT ck_call_recording_settings_mode CHECK (consent_mode IN ('announcement', 'confirmed')),
  CONSTRAINT ck_call_recording_settings_retention CHECK (retention_days BETWEEN 7 AND 365),
  CONSTRAINT ck_call_recording_settings_notice CHECK (notice_text IS NULL OR char_length(notice_text) <= 600),
  -- Switching recording on without a notice would record with nothing read out: the table refuses it too.
  CONSTRAINT ck_call_recording_settings_enabled_has_notice CHECK (NOT enabled OR (notice_text IS NOT NULL AND notice_version > 0))
);
ALTER TABLE call_recording_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_recording_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON call_recording_settings FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_call_recording_settings_touch BEFORE UPDATE ON call_recording_settings
  FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE call_recording_notice_versions (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version integer NOT NULL,
  body text NOT NULL,
  -- sha-256 of `body` exactly as presented: the proof of what was read to the person (stored as hex, never edited).
  sha256 text NOT NULL,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, version),
  CONSTRAINT fk_call_recording_notice_versions_user FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by),
  CONSTRAINT ck_call_recording_notice_versions_version CHECK (version > 0),
  CONSTRAINT ck_call_recording_notice_versions_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_call_recording_notice_versions_body CHECK (char_length(body) BETWEEN 1 AND 600)
);
ALTER TABLE call_recording_notice_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_recording_notice_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON call_recording_notice_versions FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

CREATE FUNCTION call_recording_notice_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (app_is_privileged() OR pg_trigger_depth() > 1) THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'created_by') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'created_by')
     AND (NEW.created_by IS NULL OR NEW.created_by IS NOT DISTINCT FROM OLD.created_by) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'call_recording_notice_versions is append-only: a notice version is evidence and cannot be changed or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER trg_call_recording_notice_versions_immutable BEFORE UPDATE OR DELETE ON call_recording_notice_versions
  FOR EACH ROW EXECUTE FUNCTION call_recording_notice_versions_immutable();

-- ---------------------------------------------------------------------------------------------------------------------------
-- the evidence and the lifecycle, on the call
-- ---------------------------------------------------------------------------------------------------------------------------

ALTER TABLE wa_calls
  -- The person's answer to "this call may be recorded", how it was given, when, by which teammate, and which notice text was read.
  ADD COLUMN recording_consent_status text,
  ADD COLUMN recording_consent_method text,
  ADD COLUMN recording_consent_at timestamptz,
  ADD COLUMN recording_consent_by bigint,
  ADD COLUMN recording_notice_version integer,
  ADD COLUMN recording_notice_sha256 text,
  -- When the file was stored: the retention clock.
  ADD COLUMN recording_stored_at timestamptz,
  -- A legal hold keeps the file out of the sweep and out of a manual delete. Placing or lifting it is audited.
  ADD COLUMN recording_legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN recording_hold_reason text,
  -- Set when the file is removed by the sweep or by hand; the call row stays so billing and the log stay correct.
  ADD COLUMN recording_deleted_at timestamptz,
  ADD COLUMN recording_deleted_reason text,
  ADD CONSTRAINT fk_wa_calls_recording_consent_by FOREIGN KEY (org_id, recording_consent_by) REFERENCES users (org_id, id) ON DELETE SET NULL (recording_consent_by),
  ADD CONSTRAINT ck_wa_calls_recording_consent_status CHECK (recording_consent_status IN ('granted', 'declined')),
  ADD CONSTRAINT ck_wa_calls_recording_consent_method CHECK (recording_consent_method IN ('announcement_continue', 'spoken_yes')),
  ADD CONSTRAINT ck_wa_calls_recording_notice_sha CHECK (recording_notice_sha256 IS NULL OR recording_notice_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_wa_calls_recording_deleted_reason CHECK (recording_deleted_reason IN ('retention', 'manual', 'consent_withdrawn')),
  ADD CONSTRAINT ck_wa_calls_recording_hold_reason CHECK (NOT recording_legal_hold OR recording_hold_reason IS NOT NULL);

SELECT set_config('app.privileged', 'on', true);
-- Recordings made before this setting existed: the retention clock starts now (see the header).
UPDATE wa_calls SET recording_stored_at = now() WHERE recording_path IS NOT NULL;

-- The sweep's lookup: recordings still in storage, oldest first.
CREATE INDEX idx_wa_calls_recording_stored_at ON wa_calls (recording_stored_at)
  WHERE recording_path IS NOT NULL AND NOT recording_legal_hold;

-- ---------------------------------------------------------------------------------------------------------------------------
-- permissions
-- ---------------------------------------------------------------------------------------------------------------------------
-- call.recordings.manage: write the recording settings (switch, mode, notice, retention) and delete one recording by hand. A legal hold
-- on a recording uses the privacy key `privacy.requests.manage` (Owner and Admin), as spec 4.6 asks for a distinct permission.
-- Owner and Admin only: whether customers' voices are kept, and for how long, is a workspace decision, not an operator's.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('call.recordings.manage', 'Set the call recording rules and delete a call recording', 'calling', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'call.recordings.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
