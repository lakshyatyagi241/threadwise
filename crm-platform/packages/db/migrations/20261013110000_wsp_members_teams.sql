-- wsp: workspace members and teams (WD-WSP-015..022, 046).
-- What this migration adds: an invitation is a user_tokens row of kind 'invite' (token hash only, single use, expiry), so the
-- kind CHECK gains a fourth value. Everything else the member and team screens need already exists: the five workspace roles
-- (Owner, Admin, Manager, Agent, Viewer) and the keys `org.member.invite`, `org.member.role_assign` and `inbox.team.manage` come
-- from 20261013100000_rbac_workspace_presets.sql, and an organization always keeps an Owner (the database enforces it). This
-- file sorts after it on purpose.

ALTER TABLE user_tokens DROP CONSTRAINT chk_user_tokens_kind;
ALTER TABLE user_tokens ADD CONSTRAINT chk_user_tokens_kind
  CHECK (kind IN ('email_verify', 'password_reset', 'email_change', 'invite'));
