-- wsp: operator impersonation as an act-as session (TW-WSP-032/033).
-- Why this migration exists: the baseline copied Reference's `impersonation_sessions` verbatim (admin_user_id + original_workspace_id,
-- a browser-session key, no expiry, no read-only mode). Here an operator is a `platform_operators` row, never a workspace user, and the
-- workspace side is entered with a short-lived act-as access token whose `imp.sid` names a row of this table. So the row needs: who
-- (operator), as whom (the workspace owner), how long (expires_at, never renewed), read-only or not, how it ended, and the one-time
-- handoff code that turns the operator's click into that token (only its hash is stored, 60 seconds, single use).
-- The table stays platform-only (privileged_only policy, like platform_sessions): a workspace member must never be able to read or
-- close the session that is looking at them; the workspace-side checks go through PlatformStore.
--
-- The column `target_workspace_id` keeps its baseline name (it is the org of the session) so the schema map and drift check stay valid.
-- `admin_user_id` and `original_workspace_id` are dropped: an operator has no "own workspace" to restore and no workspace user id.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM impersonation_sessions) THEN
    -- Nothing wrote to this table before this change (the 501 stub never created a row); a row here means someone inserted by hand.
    RAISE EXCEPTION 'impersonation_sessions has rows written in the Reference shape; map them by hand before running this migration';
  END IF;
END $$;

ALTER TABLE impersonation_sessions
  DROP COLUMN admin_user_id,
  DROP COLUMN original_workspace_id,
  ADD COLUMN operator_id         bigint NOT NULL REFERENCES platform_operators (id) ON DELETE RESTRICT,
  ADD COLUMN target_user_id      bigint NOT NULL,
  ADD COLUMN read_only           boolean NOT NULL DEFAULT false,
  ADD COLUMN expires_at          timestamptz NOT NULL,
  ADD COLUMN ended_by            text,
  ADD COLUMN handoff_code_hash   text,
  ADD COLUMN handoff_expires_at  timestamptz NOT NULL,
  ADD COLUMN handoff_used_at     timestamptz,
  ADD CONSTRAINT fk_impersonation_sessions_target_user
    FOREIGN KEY (target_workspace_id, target_user_id) REFERENCES users (org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_impersonation_sessions_reason CHECK (char_length(reason) BETWEEN 8 AND 500),
  ADD CONSTRAINT chk_impersonation_sessions_ended_by
    CHECK (ended_by IS NULL OR ended_by IN ('operator', 'expiry', 'new_session', 'access_revoked')),
  ADD CONSTRAINT chk_impersonation_sessions_end_pair CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  ADD CONSTRAINT chk_impersonation_sessions_window CHECK (expires_at > started_at);

-- An operator has at most one open session: starting a new one closes the previous in the same transaction (ended_by 'new_session').
CREATE UNIQUE INDEX uq_impersonation_sessions_one_open ON impersonation_sessions (operator_id) WHERE ended_at IS NULL;
-- The redeem lookup. Unique so a (vanishingly unlikely) collision can never resolve to the wrong session.
CREATE UNIQUE INDEX uq_impersonation_sessions_handoff ON impersonation_sessions (handoff_code_hash) WHERE handoff_code_hash IS NOT NULL;
CREATE INDEX idx_impersonation_sessions_operator_started ON impersonation_sessions (operator_id, started_at DESC);
-- Expiry sweep and "who is inside this workspace now".
CREATE INDEX idx_impersonation_sessions_open_expiry ON impersonation_sessions (expires_at) WHERE ended_at IS NULL;

-- Every audit_log row written while an operator is acting as a workspace user says so (TW-WSP-032 rule 5 asked for it; Reference only
-- recorded the admin's own user id). The API sets two transaction-local settings when the request carries an act-as token; a trigger
-- stamps the row, so the ~20 services that write audit_log directly cannot forget. The stamp uses the {old,new} delta shape so
-- readers of `delta` that iterate its keys keep working.
CREATE OR REPLACE FUNCTION stamp_audit_impersonation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  op  text := nullif(current_setting('app.impersonator_id', true), '');
  sid text := nullif(current_setting('app.impersonation_id', true), '');
BEGIN
  IF op IS NOT NULL THEN
    NEW.delta := coalesce(NEW.delta, '{}'::jsonb) || jsonb_build_object(
      '_impersonatedBy',
      jsonb_build_object('old', NULL, 'new', jsonb_build_object('operatorId', op, 'sessionId', sid))
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_audit_log_impersonation BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION stamp_audit_impersonation();
