-- mail phase 2: the shared schema of IMAP/SMTP, Microsoft 365, Gmail push, personal mailboxes, signatures, outbound attachments and bounces
-- (TW-MAIL-027, 031 to 035; docs/threadwise-port/plan/channel-email-build.md, "Phase 2 seams (as built)").
-- Why this migration exists: six parallel builds extend the Gmail-only `mail_mailboxes` of 20261118090000. Everything they share is created
-- here once so none of them writes a migration of its own.
--
--  * mail_mailboxes becomes provider-agnostic: provider google | microsoft | imap; `connection_enc` seals what a password provider needs
--    (IMAP and SMTP host, port, security, user name, password) or an OAuth provider's extras; `connection_public` is the non-secret summary the
--    hub shows (host, port, security, user name; never the password); `sync_cursor` replaces Gmail's `history_id` with a provider-defined
--    cursor (Gmail {historyId}, IMAP {uidValidity, lastUid}, Graph {deltaLink}); `push_state` holds a Gmail watch / Graph subscription;
--    `send_limit_per_hour` is the per-mailbox send cap (the counters live in Redis, there is no send-log table).
--  * Personal mailboxes (scope 'personal') must name their owner. The owner foreign key now CASCADES: a personal mailbox cannot outlive the
--    person whose it is (the conversations stay on their inbox channel, which the app switches to read-only).
--  * mail_workspace_settings: the per-workspace sharing policy of personal mailboxes (one row per workspace, created on first write).
--  * mail_signatures: scope 'mailbox' (the shared signature of one mailbox) or 'user' (an agent's own signature). Resolution at send time:
--    the signature the composer names, else the replying user's default user signature, else the mailbox's default mailbox signature, else none.
--  * mail_outbound_attachments: files uploaded in the composer and staged until the reply is sent (or they expire).
-- Gmail's `history_id` moves into `sync_cursor` and the column is dropped.

-- --- mail_mailboxes -------------------------------------------------------------------------------------------------------------------
ALTER TABLE mail_mailboxes DROP CONSTRAINT chk_mail_mailboxes_provider;
ALTER TABLE mail_mailboxes ADD CONSTRAINT chk_mail_mailboxes_provider CHECK (provider IN ('google', 'microsoft', 'imap'));

ALTER TABLE mail_mailboxes
  ADD COLUMN connection_enc text,            -- sealed JSON (credentials key): IMAP/SMTP settings and password, or OAuth extras
  ADD COLUMN connection_public jsonb,        -- non-secret summary for the hub: {host, port, security, username, smtpHost, smtpPort, smtpSecurity}
  ADD COLUMN sync_cursor jsonb,              -- provider-defined sync position; NULL = not synced yet (the next sync backfills)
  ADD COLUMN push_state jsonb,               -- {kind, id, expiresAt, ...} of a Gmail watch or a Graph subscription; NULL = polling only
  ADD COLUMN send_limit_per_hour integer;    -- NULL = the platform default

UPDATE mail_mailboxes SET sync_cursor = jsonb_build_object('historyId', history_id) WHERE history_id IS NOT NULL;
ALTER TABLE mail_mailboxes DROP COLUMN history_id;

ALTER TABLE mail_mailboxes ADD CONSTRAINT chk_mail_mailboxes_connection_sealed
  CHECK (connection_enc IS NULL OR connection_enc ~ '^v[0-9]+:');
ALTER TABLE mail_mailboxes ADD CONSTRAINT chk_mail_mailboxes_send_limit
  CHECK (send_limit_per_hour IS NULL OR (send_limit_per_hour BETWEEN 1 AND 10000));
ALTER TABLE mail_mailboxes ADD CONSTRAINT chk_mail_mailboxes_personal_owner
  CHECK (scope = 'shared' OR owner_user_id IS NOT NULL);

ALTER TABLE mail_mailboxes DROP CONSTRAINT fk_mail_mailboxes_owner;
ALTER TABLE mail_mailboxes ADD CONSTRAINT fk_mail_mailboxes_owner FOREIGN KEY (org_id, owner_user_id)
  REFERENCES users (org_id, id) ON DELETE CASCADE;

CREATE INDEX idx_mail_mailboxes_personal ON mail_mailboxes (org_id, owner_user_id) WHERE scope = 'personal';
-- The push renewal sweep and the push webhook look a mailbox up by what the provider calls it.
CREATE INDEX idx_mail_mailboxes_push ON mail_mailboxes (provider) WHERE push_state IS NOT NULL;

-- --- mail_workspace_settings ----------------------------------------------------------------------------------------------------------
CREATE TABLE mail_workspace_settings (
  org_id bigint NOT NULL PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  personal_mailboxes_enabled boolean NOT NULL DEFAULT false,
  -- Who may connect their own personal mailbox once the workspace allows it: only admins, or any agent holding the permission.
  who_may_connect_personal text NOT NULL DEFAULT 'admins',
  -- Whether workspace admins can read the conversations of other people's personal mailboxes.
  admins_can_read_personal boolean NOT NULL DEFAULT false,
  updated_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_mail_workspace_settings_who CHECK (who_may_connect_personal IN ('admins', 'agents')),
  CONSTRAINT fk_mail_workspace_settings_updated_by FOREIGN KEY (org_id, updated_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by)
);
ALTER TABLE mail_workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_workspace_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mail_workspace_settings FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_mail_workspace_settings_touch BEFORE UPDATE ON mail_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- --- mail_signatures ------------------------------------------------------------------------------------------------------------------
CREATE TABLE mail_signatures (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  mailbox_id bigint,                  -- scope 'mailbox': the mailbox this signature belongs to
  user_id bigint,                     -- scope 'user': the agent whose signature it is
  name text NOT NULL,
  body_html text NOT NULL DEFAULT '', -- sanitised on write
  body_text text NOT NULL DEFAULT '', -- the plain text twin appended to the text part
  is_default boolean NOT NULL DEFAULT false,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT chk_mail_signatures_scope CHECK (scope IN ('mailbox', 'user')),
  CONSTRAINT chk_mail_signatures_owner CHECK (
    (scope = 'mailbox' AND mailbox_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'user' AND user_id IS NOT NULL AND mailbox_id IS NULL)
  ),
  CONSTRAINT chk_mail_signatures_name CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  CONSTRAINT chk_mail_signatures_size CHECK (char_length(body_html) <= 20000 AND char_length(body_text) <= 5000),
  CONSTRAINT fk_mail_signatures_mailbox FOREIGN KEY (org_id, mailbox_id)
    REFERENCES mail_mailboxes (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mail_signatures_user FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mail_signatures_created_by FOREIGN KEY (org_id, created_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (created_by)
);
CREATE INDEX idx_mail_signatures_mailbox ON mail_signatures (org_id, mailbox_id) WHERE mailbox_id IS NOT NULL;
CREATE INDEX idx_mail_signatures_user ON mail_signatures (org_id, user_id) WHERE user_id IS NOT NULL;
-- At most one default per mailbox and one per user.
CREATE UNIQUE INDEX uq_mail_signatures_default_mailbox ON mail_signatures (org_id, mailbox_id)
  WHERE is_default AND scope = 'mailbox';
CREATE UNIQUE INDEX uq_mail_signatures_default_user ON mail_signatures (org_id, user_id)
  WHERE is_default AND scope = 'user';
ALTER TABLE mail_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_signatures FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mail_signatures FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_mail_signatures_touch BEFORE UPDATE ON mail_signatures
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- --- mail_outbound_attachments --------------------------------------------------------------------------------------------------------
CREATE TABLE mail_outbound_attachments (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  uploaded_by bigint,
  conversation_id bigint,             -- the conversation the composer was open on; NULL until known
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  object_key text NOT NULL,           -- the object-store key (ChatMediaStore); the bytes never sit in the database
  used_at timestamptz,                -- set when a sent reply took the file
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT chk_mail_outbound_attachments_size CHECK (size > 0),
  CONSTRAINT chk_mail_outbound_attachments_name CHECK (btrim(name) <> '' AND char_length(name) <= 255),
  CONSTRAINT fk_mail_outbound_attachments_uploaded_by FOREIGN KEY (org_id, uploaded_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (uploaded_by),
  CONSTRAINT fk_mail_outbound_attachments_conversation FOREIGN KEY (org_id, conversation_id)
    REFERENCES conversations (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_mail_outbound_attachments_uploader ON mail_outbound_attachments (org_id, uploaded_by);
CREATE INDEX idx_mail_outbound_attachments_conversation ON mail_outbound_attachments (org_id, conversation_id) WHERE conversation_id IS NOT NULL;
-- The cleanup sweep: staged files nobody sent.
CREATE INDEX idx_mail_outbound_attachments_expiry ON mail_outbound_attachments (expires_at) WHERE used_at IS NULL;
ALTER TABLE mail_outbound_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_outbound_attachments FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mail_outbound_attachments FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
