-- con: contact groups, reshaped from the Reference draft into the real thing.
-- Why this migration exists: 20261001103500 drafted `contact_groups` as a straight copy of Reference's table (the name
-- in `user_group`, an unused `status`, no uniqueness, a free-form colour), and it holds no rows yet. The Reference
-- inventory (TW-CON-034..037, differences #6 and #29) calls those out as defects: duplicate names, a colour that can be
-- any string, a dead flag. The membership table `contact_group_members` from the same draft is already right (join
-- table, composite FKs to contacts and groups, ON DELETE CASCADE so deleting a group or a contact detaches cleanly) and is
-- kept as is. 20261001103500 is applied and immutable, so this fixes forward.

-- A group with no usable name cannot exist; give any stray row a name rather than fail the migration.
UPDATE contact_groups SET user_group = 'Group ' || id WHERE user_group IS NULL OR btrim(user_group) = '';
UPDATE contact_groups SET color = NULL WHERE color IS NOT NULL AND color !~ '^#[0-9A-Fa-f]{6}$';
-- Names that collide ignoring case: keep the oldest, suffix the rest, so the unique index below can be built.
UPDATE contact_groups g
   SET user_group = g.user_group || ' (' || g.id || ')'
 WHERE EXISTS (
   SELECT 1 FROM contact_groups o
    WHERE o.org_id = g.org_id AND lower(btrim(o.user_group)) = lower(btrim(g.user_group)) AND o.id < g.id
 );

ALTER TABLE contact_groups RENAME COLUMN user_group TO name;
ALTER TABLE contact_groups RENAME COLUMN user_id TO created_by;
ALTER TABLE contact_groups ALTER COLUMN name SET NOT NULL;
ALTER TABLE contact_groups DROP COLUMN status;

ALTER TABLE contact_groups
  ADD CONSTRAINT chk_contact_groups_name CHECK (btrim(name) <> '' AND char_length(name) <= 191),
  ADD CONSTRAINT chk_contact_groups_note CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT chk_contact_groups_color CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

-- One group per name per workspace, whatever the case. Two simultaneous creates cannot both win, which the
-- compare-in-application approach could not promise.
CREATE UNIQUE INDEX uq_contact_groups_org_lower_name ON contact_groups (org_id, lower(name));
CREATE INDEX idx_contact_groups_org_created ON contact_groups (org_id, created_at DESC, id DESC);

-- "Which groups is this contact in" and "how many members" both start from one side of the join table; the other side
-- is covered by the (org_id, contact_id, group_id) unique constraint and idx_contact_group_members_group_id from the draft.
