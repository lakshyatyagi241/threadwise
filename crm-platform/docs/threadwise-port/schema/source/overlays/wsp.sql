-- users: the membership timestamps Reference keeps on workspace_user. Reference lets one account join several workspaces; here
-- a user row already belongs to exactly one org, so these two columns live on the row itself.
ALTER TABLE users
  ADD COLUMN invited_at timestamptz,
  ADD COLUMN joined_at  timestamptz;

-- teams: Reference's team settings (routing strategy, hours, devices). The slug is unique per org but nullable so the teams
-- that already exist keep working until someone names them.
ALTER TABLE teams
  ADD COLUMN slug                text,
  ADD COLUMN color               text NOT NULL DEFAULT '#075E54',
  ADD COLUMN description         text,
  ADD COLUMN default_assignee_id bigint,
  ADD COLUMN assignment_strategy text NOT NULL DEFAULT 'manual',
  ADD COLUMN business_hours      jsonb,
  ADD COLUMN timezone            text,
  ADD COLUMN device_ids          jsonb,
  ADD COLUMN is_default          boolean NOT NULL DEFAULT false,
  ADD COLUMN sort                integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT uq_teams_org_slug UNIQUE (org_id, slug),
  ADD CONSTRAINT fk_teams_default_assignee_id FOREIGN KEY (org_id, default_assignee_id)
    REFERENCES users (org_id, id) ON DELETE SET NULL (default_assignee_id);
CREATE INDEX idx_teams_org_default ON teams (org_id, is_default);

-- team_members: Reference team_user carries lead flag and a concurrent-conversation capacity per member.
ALTER TABLE team_members
  ADD COLUMN is_lead  boolean NOT NULL DEFAULT false,
  ADD COLUMN capacity integer NOT NULL DEFAULT 20;
