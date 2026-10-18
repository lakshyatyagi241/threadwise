-- storage quota, phase S0: the four tables (docs/specs/storage-quota-and-archival.md section 4.1, backlog BL-300).
-- Not a Reference feature (product extension): Reference has no storage meter.
--
-- Why this migration exists: storage is shared infrastructure (one platform bucket) and nothing today says how much of it a workspace
-- holds, so nothing can bound it, bill for it or warn about it. These tables are where that number lives. In phases S0 and S1 they are
-- only WRITTEN and READ for display (observe mode): no write is ever refused because of them.
--
--   storage_org_state     one row per workspace: hot bytes, bytes reserved by uploads in flight, the cap last computed, the level, the mode.
--                         The row the atomic reservation updates (phase S2 turns that update into the conditional one of section 4.2).
--   storage_usage         counters per (workspace, category): hot bytes, cold bytes, objects. For the breakdown and the operator's reports.
--   storage_objects       one row per counted object: its key (unique per workspace), category, size, tier, state and, once known, the row
--                         that owns it. The registry the screen, the archiver, the sweeps and the reconciliation read. A Postgres blob
--                         (team chat attachment) is registered under the pseudo key `pg:<table>:<id>`.
--   storage_reservations  space reserved by an upload that has not committed yet. A crash between "reserved" and "committed" cannot leak
--                         space for ever: the reaper returns what has expired.
--
-- Counters are derived data: the nightly counter check recomputes them from storage_objects, and storage_objects can be rebuilt from the
-- owner tables and the bucket (the backfill). Nothing here is a source of truth for a file; the object store and the owner row are.
--
-- No personal data lives here: keys are `<area>/<workspace>/.../<random>` and never carry a name or a number; owner_table / owner_id name a row
-- of another table without copying anything from it. Erasure reaches these rows through ChatMediaStore.remove / MediaStorageService.remove
-- (they delete the registry row and give the bytes back) and through the organization's ON DELETE CASCADE.

-- ---------------------------------------------------------------------------------------------------------------------------
-- storage_org_state
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE TABLE storage_org_state (
  org_id             bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Bytes of counted objects in the hot tier. Never below zero: a delete that races a reaper gives back at most what is there.
  hot_bytes          bigint NOT NULL DEFAULT 0,
  -- Bytes promised to uploads that have not committed yet (storage_reservations).
  reserved_bytes     bigint NOT NULL DEFAULT 0,
  -- Customer media stored above the cap inside the grace allowance (phase S2); released as space is freed.
  grace_used_bytes   bigint NOT NULL DEFAULT 0,
  -- The cap last computed from the plan (storage_gb, in bytes), for display and sweeps. 0 = unlimited. The decision to refuse reads the
  -- entitlement service per call, never this column.
  cap_bytes          bigint NOT NULL DEFAULT 0,
  level              text NOT NULL DEFAULT 'ok',
  -- Bumped when usage falls back under 75% so a level can fire again (warning hysteresis, phase S3).
  level_cycle        integer NOT NULL DEFAULT 0,
  over_since         timestamptz,
  -- 'inherit' follows the platform setting storage.quota.mode; the other values are a per-workspace override (the operator switch, phase S2).
  mode               text NOT NULL DEFAULT 'inherit',
  -- The nightly counter check: when it last ran for this workspace, and how many bytes it had to correct.
  last_reconciled_at timestamptz,
  last_drift_bytes   bigint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  row_version        integer NOT NULL DEFAULT 1,
  -- One row per workspace: org_id is the whole key, as for the other one-row-per-workspace tables.
  PRIMARY KEY (org_id),
  CONSTRAINT chk_storage_org_state_bytes CHECK (hot_bytes >= 0 AND reserved_bytes >= 0 AND grace_used_bytes >= 0 AND cap_bytes >= 0 AND last_drift_bytes >= 0),
  CONSTRAINT chk_storage_org_state_level CHECK (level IN ('ok', 'warn80', 'full', 'over')),
  CONSTRAINT chk_storage_org_state_mode CHECK (mode IN ('inherit', 'off', 'observe', 'enforce'))
);

ALTER TABLE storage_org_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_org_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_org_state FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_storage_org_state_touch BEFORE UPDATE ON storage_org_state
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- The operator's fleet view ("top workspaces by hot bytes", "workspaces at full / over") reads across workspaces.
CREATE INDEX idx_storage_org_state_hot ON storage_org_state (hot_bytes DESC);
CREATE INDEX idx_storage_org_state_level ON storage_org_state (level) WHERE level <> 'ok';

-- ---------------------------------------------------------------------------------------------------------------------------
-- storage_usage
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE TABLE storage_usage (
  org_id      bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          bigint GENERATED BY DEFAULT AS IDENTITY,
  category    text NOT NULL,
  hot_bytes   bigint NOT NULL DEFAULT 0,
  -- Archived bytes (phase S5). Not counted toward the quota, shown apart.
  cold_bytes  bigint NOT NULL DEFAULT 0,
  objects     bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  CONSTRAINT uq_storage_usage_category UNIQUE (org_id, category),
  CONSTRAINT chk_storage_usage_bytes CHECK (hot_bytes >= 0 AND cold_bytes >= 0 AND objects >= 0),
  CONSTRAINT chk_storage_usage_category CHECK (category IN (
    'call_recording', 'inbox_media', 'inbox_media_inbound', 'email_attachment_inbound', 'email_attachment_staged', 'contact_file',
    'scheduled_media', 'campaign_media', 'ai_training_file', 'team_chat_attachment', 'channel_profile_media', 'unknown',
    'temporary_export', 'privacy_export', 'system_asset', 'payment_proof'))
);

ALTER TABLE storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_usage FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_usage FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_storage_usage_touch BEFORE UPDATE ON storage_usage
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------------------------------------------------------
-- storage_objects
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE TABLE storage_objects (
  org_id         bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id             bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid           uuid NOT NULL DEFAULT gen_random_uuid(),
  -- The object key as the owner row stores it (`chat/<org>/<yyyy>/<mm>/<random>.<ext>`), or `pg:<table>:<id>` for a Postgres blob.
  key            text NOT NULL,
  category       text NOT NULL,
  -- Counted by the server (buffer length, the spool counter), never taken from a client.
  bytes          bigint NOT NULL DEFAULT 0,
  sha256         text,
  state          text NOT NULL DEFAULT 'live',
  tier           text NOT NULL DEFAULT 'hot',
  -- The row that owns the object, once the caller has linked it. NULL while `pending`.
  owner_table    text,
  owner_id       bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  row_version    integer NOT NULL DEFAULT 1,
  -- Phase S5 (cold tier): when it moved, until when a restored copy is hot, and the date retention deletes it.
  cold_at        timestamptz,
  restored_until timestamptz,
  retain_until   timestamptz,
  PRIMARY KEY (org_id, id),
  CONSTRAINT uq_storage_objects_uuid UNIQUE (org_id, uuid),
  CONSTRAINT uq_storage_objects_key UNIQUE (org_id, key),
  CONSTRAINT chk_storage_objects_key CHECK (length(key) BETWEEN 1 AND 1024),
  CONSTRAINT chk_storage_objects_bytes CHECK (bytes >= 0),
  CONSTRAINT chk_storage_objects_state CHECK (state IN ('pending', 'live', 'missing')),
  CONSTRAINT chk_storage_objects_tier CHECK (tier IN ('hot', 'cold', 'restored')),
  CONSTRAINT chk_storage_objects_owner CHECK ((owner_table IS NULL) = (owner_id IS NULL)),
  CONSTRAINT chk_storage_objects_category CHECK (category IN (
    'call_recording', 'inbox_media', 'inbox_media_inbound', 'email_attachment_inbound', 'email_attachment_staged', 'contact_file',
    'scheduled_media', 'campaign_media', 'ai_training_file', 'team_chat_attachment', 'channel_profile_media', 'unknown',
    'temporary_export', 'privacy_export', 'system_asset', 'payment_proof'))
);

ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_objects FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_objects FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_storage_objects_touch BEFORE UPDATE ON storage_objects
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Settings > Storage "top items" and the cleanup suggestions: largest first, per workspace.
CREATE INDEX idx_storage_objects_size ON storage_objects (org_id, bytes DESC);
CREATE INDEX idx_storage_objects_category ON storage_objects (org_id, category, tier);
-- The orphan sweep (phase S5): `pending` rows nobody linked within an hour. Partial, so it stays tiny.
CREATE INDEX idx_storage_objects_pending ON storage_objects (created_at) WHERE state = 'pending';
-- The owner check (an owner row that is gone leaves an orphan) and the backfill's idempotent lookup.
CREATE INDEX idx_storage_objects_owner ON storage_objects (org_id, owner_table, owner_id) WHERE owner_table IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------------
-- storage_reservations
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE TABLE storage_reservations (
  org_id      bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          bigint GENERATED BY DEFAULT AS IDENTITY,
  -- The token the caller holds: commit and release name the reservation by it.
  uuid        uuid NOT NULL DEFAULT gen_random_uuid(),
  bytes       bigint NOT NULL,
  category    text NOT NULL,
  -- 15 minutes after the reservation: past it the reaper returns the bytes to reserved_bytes.
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  CONSTRAINT uq_storage_reservations_uuid UNIQUE (org_id, uuid),
  CONSTRAINT chk_storage_reservations_bytes CHECK (bytes >= 0),
  CONSTRAINT chk_storage_reservations_category CHECK (category IN (
    'call_recording', 'inbox_media', 'inbox_media_inbound', 'email_attachment_inbound', 'email_attachment_staged', 'contact_file',
    'scheduled_media', 'campaign_media', 'ai_training_file', 'team_chat_attachment', 'channel_profile_media', 'unknown',
    'temporary_export', 'privacy_export', 'system_asset', 'payment_proof'))
);

ALTER TABLE storage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_reservations FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_reservations FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

-- The reaper scans expired reservations of every workspace, oldest first.
CREATE INDEX idx_storage_reservations_expiry ON storage_reservations (expires_at);
