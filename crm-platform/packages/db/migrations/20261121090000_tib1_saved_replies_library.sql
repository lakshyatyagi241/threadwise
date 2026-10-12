-- tib1: saved replies grow from a schema-only port into the workspace's reply library (TW-TIB1-024, docs/api/saved-replies.md).
-- Why this migration exists: Reference's `saved_replies` (shortcut, title, body, category, used_count, personal-or-shared) is not enough for
-- the library the inbox composer needs. Added: who created a shared reply (`created_by`), an optional language and an optional list of
-- channel kinds a reply may be inserted on (empty = all), and `last_used_at` next to `used_count`. The table keeps its composite primary
-- key, the composite foreign keys and forced row level security from 20261001102600; the owner-scoped unique shortcut index is from
-- 20261014100300 and stays.
-- Two rules move into the database so a bad write cannot get past the service: a shortcut is stored lower case without spaces or a
-- slash (the service also normalises it, this is the backstop), and the text fields have the limits Reference validated in PHP.
-- A personal reply used to fall back to "shared" when its owner row was deleted (ON DELETE SET NULL): that would publish private text
-- to the whole workspace, so the owner foreign key now deletes the personal replies with the user.
SELECT set_config('app.privileged', 'on', true);

-- Bring any rows a development database may hold in line with the new constraints (nothing in the product wrote this table before).
WITH ranked AS (
  SELECT org_id, id,
         left(regexp_replace(lower(shortcut), '[[:space:]/]+', '_', 'g'), 60) AS base,
         row_number() OVER (
           PARTITION BY org_id, user_id, left(regexp_replace(lower(shortcut), '[[:space:]/]+', '_', 'g'), 60)
           ORDER BY id
         ) AS rn
  FROM saved_replies
)
UPDATE saved_replies s
   SET shortcut = CASE WHEN ranked.base = '' THEN 'reply' || '_' || s.id::text
                       WHEN ranked.rn > 1 THEN ranked.base || '_' || ranked.rn::text
                       ELSE ranked.base END,
       title = left(btrim(s.title), 128),
       body = left(s.body, 4000),
       category = left(s.category, 64)
  FROM ranked
 WHERE ranked.org_id = s.org_id AND ranked.id = s.id;

ALTER TABLE saved_replies
  ADD COLUMN created_by bigint,
  ADD COLUMN language text,
  ADD COLUMN channel_kinds text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_used_at timestamptz;

ALTER TABLE saved_replies
  ADD CONSTRAINT fk_saved_replies_created_by FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);

ALTER TABLE saved_replies DROP CONSTRAINT fk_saved_replies_user_id;
ALTER TABLE saved_replies
  ADD CONSTRAINT fk_saved_replies_user_id FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id) ON DELETE CASCADE;

ALTER TABLE saved_replies
  ADD CONSTRAINT chk_saved_replies_shortcut CHECK (shortcut = lower(shortcut) AND char_length(shortcut) BETWEEN 1 AND 64 AND shortcut !~ '[[:space:]/]'),
  ADD CONSTRAINT chk_saved_replies_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 128),
  ADD CONSTRAINT chk_saved_replies_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  ADD CONSTRAINT chk_saved_replies_category CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 64),
  ADD CONSTRAINT chk_saved_replies_language CHECK (language IS NULL OR char_length(language) BETWEEN 2 AND 16),
  ADD CONSTRAINT chk_saved_replies_channel_kinds CHECK (cardinality(channel_kinds) <= 20);

-- The picker and the settings list are ordered by use, most used first (Reference's order), then by id.
CREATE INDEX idx_saved_replies_usage ON saved_replies (org_id, used_count DESC, id);

-- Using a reply is not editing it. The generic touch_row() bumps row_version on every UPDATE, so each insert into a composer would make
-- an open edit dialog fail with a 409 on save. This trigger leaves updated_at and row_version alone when the only columns that changed
-- are the usage counters, and behaves exactly like touch_row() for every other update.
CREATE OR REPLACE FUNCTION saved_replies_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'used_count' - 'last_used_at' - 'updated_at' - 'row_version')
       = (to_jsonb(OLD) - 'used_count' - 'last_used_at' - 'updated_at' - 'row_version') THEN
    NEW.updated_at := OLD.updated_at;
    NEW.row_version := OLD.row_version;
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_saved_replies_touch ON saved_replies;
CREATE TRIGGER trg_saved_replies_touch BEFORE UPDATE ON saved_replies
  FOR EACH ROW EXECUTE FUNCTION saved_replies_touch();
