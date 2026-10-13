-- Contact views: "Share with" gets a third choice and an access level, as in Reference's view editor.
--
-- Until now a view was either the creator's alone or visible to the whole workspace (`is_shared`). A view can now also be shared with
-- chosen people only (`share_mode = 'selected'`, the people in `contact_view_users`), and whoever it is shared with either may only
-- open it (`can_view`) or open and change it (`can_edit`). Changing the sharing and deleting stay with the creator.
--
-- `is_shared` stays as "visible beyond the creator" (any mode but 'me'); the service keeps it in step with `share_mode`, so a reader of
-- the old column still gets the right answer. A view that was shared before this migration was visible to everyone and any viewer could
-- edit it, so it becomes 'everyone' + 'can_edit': nothing changes for what exists today.

ALTER TABLE contact_views
  ADD COLUMN share_mode  text NOT NULL DEFAULT 'me'       CHECK (share_mode  IN ('me', 'everyone', 'selected')),
  ADD COLUMN access_type text NOT NULL DEFAULT 'can_view' CHECK (access_type IN ('can_view', 'can_edit'));

UPDATE contact_views SET share_mode = 'everyone', access_type = 'can_edit' WHERE is_shared;

-- Pure membership, like contact_view_favorites: who a 'selected' view is shared with.
CREATE TABLE contact_view_users (
  org_id     bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  view_id    bigint NOT NULL,
  user_id    bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, view_id, user_id),
  FOREIGN KEY (org_id, view_id) REFERENCES contact_views (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES users          (org_id, id) ON DELETE CASCADE
);
-- "Which views are shared with me": the visibility check of every list.
CREATE INDEX idx_contact_view_users_user ON contact_view_users (org_id, user_id);

ALTER TABLE contact_view_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_view_users FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contact_view_users FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
